use std::{env, sync::Arc, time::Duration};

use axum::{
    http::{
        HeaderMap, HeaderName, StatusCode,
        header::{CACHE_CONTROL, CONTENT_TYPE, X_CONTENT_TYPE_OPTIONS},
    },
    response::{IntoResponse, Response},
};
use futures_util::TryStreamExt;
use mongodb::{
    Client, Collection, IndexModel,
    bson::{DateTime, Document, doc, oid::ObjectId},
    change_stream::{ChangeStream, event::ChangeStreamEvent},
    error::NO_WRITES_PERFORMED,
    options::{ClientOptions, IndexOptions, ReadConcern, ReadPreference, WriteConcern},
};
use serde::{Deserialize, Serialize};
use tokio::sync::{OnceCell, broadcast};

use super::{
    gif::{GifUpload, validate_giphy_id, validate_giphy_url},
    media::{AttachmentKind, AttachmentUpload},
    media_store::{MediaStore, StoredAttachment},
};

const PAGE_SIZE: usize = 40;
const READ_TIMEOUT: Duration = Duration::from_secs(4);
const RECONNECT_DELAY: Duration = Duration::from_secs(1);
const UNAVAILABLE: StatusCode = StatusCode::SERVICE_UNAVAILABLE;
static STORE: OnceCell<MessageStore> = OnceCell::const_new();

pub(super) struct Conversation {
    pub(super) viewer: ObjectId,
    pub(super) contact: ObjectId,
    pub(super) key: String,
}

impl Conversation {
    pub(super) fn new(viewer: ObjectId, contact: ObjectId) -> Result<Self, StatusCode> {
        if viewer == contact {
            return Err(StatusCode::BAD_REQUEST);
        }

        let mut ids = [viewer.to_hex(), contact.to_hex()];
        ids.sort_unstable();
        Ok(Self {
            viewer,
            contact,
            key: ids.join(":"),
        })
    }
}

pub(super) struct MessageCursor {
    sent_at: DateTime,
    id: ObjectId,
}

impl MessageCursor {
    pub(super) fn parse(value: &str) -> Result<Self, StatusCode> {
        let bad_request = StatusCode::BAD_REQUEST;
        let (sent_at, id) = value.split_once(':').ok_or(bad_request)?;
        Ok(Self {
            sent_at: DateTime::from_millis(sent_at.parse().map_err(|_| bad_request)?),
            id: ObjectId::parse_str(id).map_err(|_| bad_request)?,
        })
    }
}

#[derive(Deserialize, Serialize)]
pub(super) struct StoredMessage {
    #[serde(rename = "_id")]
    id: ObjectId,
    pub(super) conversation_key: String,
    sender_id: ObjectId,
    recipient_id: ObjectId,
    client_message_id: String,
    #[serde(default)]
    text: String,
    sent_at: DateTime,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    gif: Option<StoredGif>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    giphy_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    attachments: Vec<StoredAttachment>,
    #[serde(default, skip_serializing)]
    gif_url: Option<String>,
    #[serde(default, skip_serializing)]
    gif_width: Option<u16>,
    #[serde(default, skip_serializing)]
    gif_height: Option<u16>,
}

#[derive(Default, Deserialize, Serialize)]
struct StoredGif {
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    width: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    height: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file: Option<StoredAttachment>,
}

#[derive(Serialize)]
struct GifView {
    url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    width: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    height: Option<u16>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentView {
    id: String,
    kind: AttachmentKind,
    name: String,
    mime_type: String,
    size_bytes: u32,
    url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MessageView {
    id: String,
    text: String,
    sent_at: i64,
    outgoing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    gif: Option<GifView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    giphy_id: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    attachments: Vec<AttachmentView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MessagePage {
    pub(super) messages: Vec<MessageView>,
    pub(super) next_cursor: Option<String>,
}

#[derive(Clone)]
pub(super) enum Change {
    Saved(Arc<StoredMessage>),
    Refresh,
}

#[derive(Clone)]
pub(super) struct MessageStore {
    messages: Collection<StoredMessage>,
    legacy_gifs: Collection<Document>,
    media: Arc<MediaStore>,
    changes: broadcast::Sender<Change>,
}

pub(super) async fn message_store() -> Result<&'static MessageStore, StatusCode> {
    STORE.get_or_try_init(MessageStore::from_env).await
}

impl StoredMessage {
    fn new(conversation: &Conversation, text: String, client_message_id: String) -> Self {
        Self {
            id: ObjectId::new(),
            conversation_key: conversation.key.clone(),
            sender_id: conversation.viewer,
            recipient_id: conversation.contact,
            client_message_id,
            text,
            sent_at: DateTime::now(),
            gif: None,
            giphy_id: None,
            attachments: Vec::new(),
            gif_url: None,
            gif_width: None,
            gif_height: None,
        }
    }

    pub(super) fn view(&self, viewer: ObjectId) -> MessageView {
        let id = self.id.to_hex();
        let attachments = self
            .attachments
            .iter()
            .map(|file| {
                let file_id = file.id.to_hex();
                AttachmentView {
                    url: format!("/api/messages/{id}/attachments/{file_id}"),
                    id: file_id,
                    kind: file.kind,
                    name: file.name.clone(),
                    mime_type: file.mime_type.clone(),
                    size_bytes: file.size_bytes,
                }
            })
            .collect();

        MessageView {
            id,
            text: self.text.clone(),
            sent_at: self.sent_at.timestamp_millis(),
            outgoing: self.sender_id == viewer,
            gif: self.gif_view(),
            giphy_id: self.giphy_id.clone(),
            attachments,
        }
    }

    fn gif_view(&self) -> Option<GifView> {
        let gif = self.gif.as_ref();
        let width = gif.and_then(|gif| gif.width).or(self.gif_width);
        let height = gif.and_then(|gif| gif.height).or(self.gif_height);
        let source = gif
            .and_then(|gif| gif.url.as_deref())
            .or(self.gif_url.as_deref());
        if gif.is_none() && source.is_none() && width.is_none() && height.is_none() {
            return None;
        }

        Some(GifView {
            url: source
                .and_then(|url| validate_giphy_url(url).ok())
                .unwrap_or_else(|| format!("/api/messages/{}/gif", self.id.to_hex())),
            width,
            height,
        })
    }
}

impl MessageStore {
    async fn from_env() -> Result<Self, StatusCode> {
        let uri = env::var("MONGODB_URI").map_err(|_| UNAVAILABLE)?;
        let name = env::var("MONGOTEXT_DB_NAME").map_err(|_| UNAVAILABLE)?;
        if uri.trim().is_empty() || name.trim().is_empty() {
            return Err(UNAVAILABLE);
        }

        let mut options = ClientOptions::parse(uri.trim()).await.map_err(db_error)?;
        options.server_selection_timeout = Some(READ_TIMEOUT);
        options.selection_criteria = Some(ReadPreference::Primary.into());
        options.read_concern = Some(ReadConcern::majority());
        options.write_concern = Some(WriteConcern::majority());

        let client = Client::with_options(options).map_err(db_error)?;
        let database = client.database(name.trim());
        let messages = database.collection("messages");
        messages
            .create_indexes([
                IndexModel::builder()
                    .keys(doc! { "conversation_key": 1, "sent_at": -1, "_id": -1 })
                    .build(),
                IndexModel::builder()
                    .keys(doc! { "sender_id": 1, "client_message_id": 1 })
                    .options(IndexOptions::builder().unique(true).build())
                    .build(),
            ])
            .await
            .map_err(db_error)?;

        let (changes, _) = broadcast::channel(256);
        let mut stream = watch_messages(&messages).await.map_err(db_error)?;
        let relay_collection = messages.clone();
        let relay_changes = changes.clone();

        tokio::spawn(async move {
            loop {
                while let Ok(Some(event)) = stream.try_next().await {
                    if let Some(message) = event.full_document {
                        let _ = relay_changes.send(Change::Saved(Arc::new(message)));
                    }
                }

                loop {
                    tokio::time::sleep(RECONNECT_DELAY).await;
                    if let Ok(next) = watch_messages(&relay_collection).await {
                        stream = next;
                        let _ = relay_changes.send(Change::Refresh);
                        break;
                    }
                }
            }
        });

        Ok(Self {
            messages,
            legacy_gifs: database.collection("message_gifs"),
            media: Arc::new(MediaStore::new(&database)),
            changes,
        })
    }

    pub(super) fn subscribe(&self) -> broadcast::Receiver<Change> {
        self.changes.subscribe()
    }

    pub(super) async fn history(
        &self,
        conversation: &Conversation,
        before: Option<MessageCursor>,
    ) -> Result<MessagePage, StatusCode> {
        let mut filter = doc! { "conversation_key": &conversation.key };
        if let Some(before) = before {
            filter.insert(
                "$or",
                vec![
                    doc! { "sent_at": { "$lt": before.sent_at } },
                    doc! { "sent_at": before.sent_at, "_id": { "$lt": before.id } },
                ],
            );
        }

        let mut rows: Vec<StoredMessage> = self
            .messages
            .find(filter)
            .sort(doc! { "sent_at": -1, "_id": -1 })
            .limit((PAGE_SIZE + 1) as i64)
            .projection(without_gif_bytes())
            .max_time(READ_TIMEOUT)
            .await
            .map_err(db_error)?
            .try_collect()
            .await
            .map_err(db_error)?;

        let next_cursor = if rows.len() > PAGE_SIZE {
            rows.truncate(PAGE_SIZE);
            rows.last()
                .map(|row| format!("{}:{}", row.sent_at.timestamp_millis(), row.id.to_hex()))
        } else {
            None
        };

        Ok(MessagePage {
            messages: rows
                .iter()
                .rev()
                .map(|row| row.view(conversation.viewer))
                .collect(),
            next_cursor,
        })
    }

    pub(super) async fn save(
        &self,
        conversation: &Conversation,
        text: String,
        client_message_id: String,
    ) -> Result<MessageView, StatusCode> {
        self.persist(
            StoredMessage::new(conversation, text, client_message_id),
            Vec::new(),
        )
        .await
    }

    pub(super) async fn save_gif(
        &self,
        conversation: &Conversation,
        upload: GifUpload,
        client_message_id: String,
    ) -> Result<MessageView, StatusCode> {
        let mut message = StoredMessage::new(conversation, String::new(), client_message_id);
        message.gif = Some(StoredGif {
            width: Some(upload.width),
            height: Some(upload.height),
            ..StoredGif::default()
        });
        let file = AttachmentUpload {
            name: "message.gif".to_owned(),
            kind: AttachmentKind::Image,
            mime_type: "image/gif",
            bytes: upload.bytes,
        };
        self.persist(message, vec![file]).await
    }

    pub(super) async fn save_gif_url(
        &self,
        conversation: &Conversation,
        url: String,
        client_message_id: String,
    ) -> Result<MessageView, StatusCode> {
        let mut message = StoredMessage::new(conversation, String::new(), client_message_id);
        message.gif = Some(StoredGif {
            url: Some(validate_giphy_url(&url)?),
            ..StoredGif::default()
        });
        self.persist(message, Vec::new()).await
    }

    pub(super) async fn save_giphy(
        &self,
        conversation: &Conversation,
        giphy_id: String,
        client_message_id: String,
    ) -> Result<MessageView, StatusCode> {
        let mut message = StoredMessage::new(conversation, String::new(), client_message_id);
        message.giphy_id = Some(validate_giphy_id(&giphy_id)?);
        self.persist(message, Vec::new()).await
    }

    pub(super) async fn save_attachments(
        &self,
        conversation: &Conversation,
        text: String,
        client_message_id: String,
        files: Vec<AttachmentUpload>,
    ) -> Result<MessageView, StatusCode> {
        self.persist(
            StoredMessage::new(conversation, text, client_message_id),
            files,
        )
        .await
    }

    async fn persist(
        &self,
        message: StoredMessage,
        files: Vec<AttachmentUpload>,
    ) -> Result<MessageView, StatusCode> {
        // Finish an accepted send even if the HTTP client disconnects.
        let store = self.clone();
        tokio::spawn(async move { store.insert(message, files).await })
            .await
            .map_err(|_| UNAVAILABLE)?
    }

    async fn insert(
        &self,
        mut message: StoredMessage,
        files: Vec<AttachmentUpload>,
    ) -> Result<MessageView, StatusCode> {
        if !files.is_empty()
            && let Some(saved) = self.find_sent(&message).await?
        {
            return self.replay(saved, &message, &files).await;
        }

        let uploaded = self.media.upload(&files).await?;
        if let Some(gif) = message.gif.as_mut() {
            gif.file = uploaded.first().cloned();
        } else {
            message.attachments = uploaded.clone();
        }
        message.sent_at = DateTime::now();

        let error = match self.messages.insert_one(&message).await {
            Ok(_) => return Ok(message.view(message.sender_id)),
            Err(error) => error,
        };

        if let Ok(Some(saved)) = self.find_sent(&message).await {
            if saved.id == message.id {
                return Ok(saved.view(message.sender_id));
            }
            self.media.discard(&uploaded).await;
            return self.replay(saved, &message, &files).await;
        }

        // Keep files if the insert might have succeeded without a reply.
        if error.contains_label(NO_WRITES_PERFORMED) {
            self.media.discard(&uploaded).await;
        }
        Err(db_error(error))
    }

    async fn find_sent(
        &self,
        message: &StoredMessage,
    ) -> Result<Option<StoredMessage>, StatusCode> {
        self.messages
            .find_one(doc! {
                "sender_id": message.sender_id,
                "client_message_id": &message.client_message_id,
            })
            .projection(without_gif_bytes())
            .max_time(READ_TIMEOUT)
            .await
            .map_err(db_error)
    }

    async fn replay(
        &self,
        saved: StoredMessage,
        requested: &StoredMessage,
        files: &[AttachmentUpload],
    ) -> Result<MessageView, StatusCode> {
        let conflict = StatusCode::CONFLICT;
        let saved_gif = saved.gif_view();
        let requested_gif = requested.gif_view();
        let gif_matches = match (&saved_gif, &requested_gif) {
            (Some(left), Some(right)) => {
                left.url == right.url || (left.url.starts_with('/') && right.url.starts_with('/'))
            }
            (None, None) => true,
            _ => false,
        };

        if saved.recipient_id != requested.recipient_id
            || saved.text != requested.text
            || saved.giphy_id != requested.giphy_id
            || !gif_matches
        {
            return Err(conflict);
        }

        let saved_files = match &saved.gif {
            Some(gif) => gif.file.as_slice(),
            None => &saved.attachments,
        };
        if let [file] = files
            && saved_files.is_empty()
            && saved_gif.is_some_and(|gif| gif.url.starts_with('/'))
        {
            let bytes = self
                .legacy_gif_bytes(saved.sender_id, saved.id)
                .await
                .map_err(|_| UNAVAILABLE)?;
            if bytes != file.bytes {
                return Err(conflict);
            }
        } else {
            if files.len() != saved_files.len() {
                return Err(conflict);
            }
            for (stored, file) in saved_files.iter().zip(files) {
                if !self.matches_upload(stored, file).await? {
                    return Err(conflict);
                }
            }
        }

        Ok(saved.view(requested.sender_id))
    }

    async fn matches_upload(
        &self,
        stored: &StoredAttachment,
        file: &AttachmentUpload,
    ) -> Result<bool, StatusCode> {
        if stored.name != file.name
            || stored.kind != file.kind
            || stored.mime_type != file.mime_type
            || stored.size_bytes as usize != file.bytes.len()
        {
            return Ok(false);
        }

        let mut remaining = file.bytes.as_slice();
        let mut chunks = self
            .media
            .response(stored, &HeaderMap::new())
            .await
            .map_err(|_| UNAVAILABLE)?
            .into_body()
            .into_data_stream();
        while let Some(chunk) = chunks.try_next().await.map_err(|_| UNAVAILABLE)? {
            let Some(rest) = remaining.strip_prefix(chunk.as_ref()) else {
                return Ok(false);
            };
            remaining = rest;
        }
        Ok(remaining.is_empty())
    }

    pub(super) async fn attachment_response(
        &self,
        viewer: ObjectId,
        message_id: ObjectId,
        file_id: ObjectId,
        headers: &HeaderMap,
    ) -> Result<Response, StatusCode> {
        let message = self.participant_message(viewer, message_id).await?;
        let file = message
            .attachments
            .iter()
            .find(|file| file.id == file_id)
            .ok_or(StatusCode::NOT_FOUND)?;
        self.media.response(file, headers).await
    }

    pub(super) async fn gif_response(
        &self,
        viewer: ObjectId,
        message_id: ObjectId,
        headers: &HeaderMap,
    ) -> Result<Response, StatusCode> {
        let message = self.participant_message(viewer, message_id).await?;
        if let Some(file) = message.gif.as_ref().and_then(|gif| gif.file.as_ref()) {
            return self.media.response(file, headers).await;
        }
        if !message
            .gif_view()
            .is_some_and(|gif| gif.url.starts_with('/'))
        {
            return Err(StatusCode::NOT_FOUND);
        }

        let bytes = self.legacy_gif_bytes(viewer, message_id).await?;
        Ok((
            [
                (CONTENT_TYPE, "image/gif"),
                (CACHE_CONTROL, "private, no-store"),
                (X_CONTENT_TYPE_OPTIONS, "nosniff"),
                (
                    HeaderName::from_static("cross-origin-resource-policy"),
                    "same-origin",
                ),
            ],
            bytes,
        )
            .into_response())
    }

    async fn participant_message(
        &self,
        viewer: ObjectId,
        message_id: ObjectId,
    ) -> Result<StoredMessage, StatusCode> {
        self.messages
            .find_one(participant_filter(viewer, message_id))
            .projection(without_gif_bytes())
            .max_time(READ_TIMEOUT)
            .await
            .map_err(db_error)?
            .ok_or(StatusCode::NOT_FOUND)
    }

    async fn legacy_gif_bytes(
        &self,
        viewer: ObjectId,
        message_id: ObjectId,
    ) -> Result<Vec<u8>, StatusCode> {
        let row = self
            .messages
            .clone_with_type::<Document>()
            .find_one(participant_filter(viewer, message_id))
            .projection(doc! { "gif_bytes": 1, "gif.bytes": 1 })
            .max_time(READ_TIMEOUT)
            .await
            .map_err(db_error)?
            .ok_or(StatusCode::NOT_FOUND)?;

        if let Ok(bytes) = row.get_binary_generic("gif_bytes") {
            return Ok(bytes.clone());
        }
        if let Ok(gif) = row.get_document("gif")
            && let Ok(bytes) = gif.get_binary_generic("bytes")
        {
            return Ok(bytes.clone());
        }

        let blob = self
            .legacy_gifs
            .find_one(doc! { "_id": message_id })
            .max_time(READ_TIMEOUT)
            .await
            .map_err(db_error)?
            .ok_or(StatusCode::NOT_FOUND)?;

        ["bytes", "data", "gif_bytes"]
            .iter()
            .find_map(|field| blob.get_binary_generic(field).ok().cloned())
            .ok_or(StatusCode::NOT_FOUND)
    }
}

async fn watch_messages(
    messages: &Collection<StoredMessage>,
) -> mongodb::error::Result<ChangeStream<ChangeStreamEvent<StoredMessage>>> {
    messages
        .watch()
        .pipeline([
            doc! { "$match": { "operationType": "insert" } },
            doc! { "$unset": ["fullDocument.gif_bytes", "fullDocument.gif.bytes"] },
        ])
        .await
}

fn participant_filter(viewer: ObjectId, message_id: ObjectId) -> Document {
    doc! {
        "_id": message_id,
        "$or": [{ "sender_id": viewer }, { "recipient_id": viewer }],
    }
}

fn without_gif_bytes() -> Document {
    doc! { "gif_bytes": 0, "gif.bytes": 0 }
}

fn db_error(_: mongodb::error::Error) -> StatusCode {
    UNAVAILABLE
}