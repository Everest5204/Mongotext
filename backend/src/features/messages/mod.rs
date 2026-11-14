mod gif;
mod live;
mod media;
mod media_store;
mod store;

use axum::{
    Json, Router,
    body::Bytes,
    extract::{
        DefaultBodyLimit, Extension, Multipart, Path, Query, Request, State, multipart::Field,
    },
    http::{
        HeaderMap, HeaderValue, Method, StatusCode,
        header::{CACHE_CONTROL, HOST, ORIGIN},
    },
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use mongodb::bson::oid::ObjectId;
use serde::Deserialize;
use serde_json::Value;
use tower_sessions::Session;

use super::{
    auth::{MongoksyClient, session_token},
    contacts::active_contact_exists,
};
use media::SendAttachments;
use store::{Conversation, MessageCursor, MessageView, message_store};

const MAX_MESSAGE_LENGTH: usize = 4_000;
const MAX_TEXT_REQUEST_BYTES: usize = 64 * 1024;
const MAX_GIF_REQUEST_BYTES: usize = gif::MAX_GIF_BYTES + 64 * 1024;
const MAX_ID_FIELD_BYTES: usize = 128;

#[derive(Clone, Copy)]
struct Viewer(ObjectId);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MessagesQuery {
    contact_id: String,
    before: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendText {
    contact_id: String,
    client_message_id: String,
    text: String,
}

enum GifSource {
    File(Bytes),
    Url(String),
    GiphyId(String),
}

struct SendGif {
    contact_id: String,
    client_message_id: String,
    source: GifSource,
}

type SendResult = Result<(StatusCode, Json<MessageView>), StatusCode>;

pub(super) fn routes(client: Result<MongoksyClient, StatusCode>) -> Router {
    Router::new()
        .route(
            "/api/messages",
            get(history)
                .post(send_text)
                .layer(DefaultBodyLimit::max(MAX_TEXT_REQUEST_BYTES)),
        )
        .route("/api/messages/live", get(stream))
        .route(
            "/api/messages/gif",
            post(send_gif).layer(DefaultBodyLimit::max(MAX_GIF_REQUEST_BYTES)),
        )
        .route("/api/messages/{message_id}/gif", get(get_gif))
        .route(
            "/api/messages/attachments",
            post(send_attachments)
                .layer(DefaultBodyLimit::max(media::MAX_ATTACHMENT_REQUEST_BYTES)),
        )
        .route(
            "/api/messages/{message_id}/attachments/{file_id}",
            get(get_attachment),
        )
        .route_layer(middleware::from_fn_with_state(client, authorize_request))
}

async fn authorize_request(
    State(client): State<Result<MongoksyClient, StatusCode>>,
    session: Session,
    mut request: Request,
    next: Next,
) -> Response {
    let mut response = if request.method() == Method::POST && !same_local_origin(request.headers())
    {
        StatusCode::FORBIDDEN.into_response()
    } else {
        match authenticated_viewer(client, &session).await {
            Ok(viewer) => {
                request.extensions_mut().insert(viewer);
                next.run(request).await
            }
            Err(status) => status.into_response(),
        }
    };

    response
        .headers_mut()
        .entry(CACHE_CONTROL)
        .or_insert(HeaderValue::from_static("private, no-store"));
    response
}

async fn authenticated_viewer(
    client: Result<MongoksyClient, StatusCode>,
    session: &Session,
) -> Result<Viewer, StatusCode> {
    let token = session_token(session).await?;
    let account = match client?.get_json::<Value>("/api/user/me", &token).await {
        Ok(account) => account,
        Err(status @ (StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN)) => {
            session
                .flush()
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            return Err(status);
        }
        Err(status) => return Err(status),
    };

    account_id(&account)
        .map(Viewer)
        .ok_or(StatusCode::BAD_GATEWAY)
}

fn account_id(account: &Value) -> Option<ObjectId> {
    ["id", "_id", "userId", "user_id"]
        .into_iter()
        .filter_map(|key| account.get(key))
        .filter_map(|id| {
            id.as_str()
                .or_else(|| id.get("$oid").and_then(Value::as_str))
        })
        .find_map(|id| ObjectId::parse_str(id).ok())
        .or_else(|| account.get("user").and_then(account_id))
        .or_else(|| account.get("data").and_then(account_id))
}

fn same_local_origin(headers: &HeaderMap) -> bool {
    let Some(host) = headers.get(HOST).and_then(|value| value.to_str().ok()) else {
        return false;
    };
    headers
        .get(ORIGIN)
        .and_then(|value| value.to_str().ok())
        .and_then(|origin| origin.strip_prefix("http://"))
        == Some(host)
}

async fn conversation_for(viewer: Viewer, contact_id: &str) -> Result<Conversation, StatusCode> {
    let conversation = Conversation::new(viewer.0, parse_object_id(contact_id)?)?;
    if !active_contact_exists(conversation.contact).await? {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(conversation)
}

async fn history(
    Extension(viewer): Extension<Viewer>,
    Query(query): Query<MessagesQuery>,
) -> Result<impl IntoResponse, StatusCode> {
    let before = query
        .before
        .as_deref()
        .map(MessageCursor::parse)
        .transpose()?;
    let conversation = conversation_for(viewer, &query.contact_id).await?;
    let page = message_store()
        .await?
        .history(&conversation, before)
        .await?;
    Ok(Json(page))
}

async fn stream(
    Extension(viewer): Extension<Viewer>,
    Query(query): Query<MessagesQuery>,
) -> Result<Response, StatusCode> {
    let conversation = conversation_for(viewer, &query.contact_id).await?;
    let store = message_store().await?;

    // Subscribe first so a send during the history read can still be delivered.
    let changes = store.subscribe();
    let snapshot = store.history(&conversation, None).await?;
    Ok(live::response(conversation, snapshot, changes))
}

async fn send_text(
    Extension(viewer): Extension<Viewer>,
    Json(input): Json<SendText>,
) -> SendResult {
    let text = input.text.trim();
    if text.is_empty() || text.chars().count() > MAX_MESSAGE_LENGTH {
        return Err(StatusCode::BAD_REQUEST);
    }
    let client_id = validate_client_id(&input.client_message_id)?;
    let conversation = conversation_for(viewer, &input.contact_id).await?;
    let message = message_store()
        .await?
        .save(&conversation, text.to_owned(), client_id)
        .await?;
    Ok((StatusCode::CREATED, Json(message)))
}

async fn send_gif(Extension(viewer): Extension<Viewer>, form: Multipart) -> SendResult {
    let input = read_gif_form(form).await?;
    let client_id = validate_client_id(&input.client_message_id)?;
    let conversation = conversation_for(viewer, &input.contact_id).await?;
    let store = message_store().await?;
    let message = match input.source {
        GifSource::File(bytes) => {
            let upload = gif::validate_upload(bytes).await?;
            store.save_gif(&conversation, upload, client_id).await?
        }
        GifSource::Url(url) => store.save_gif_url(&conversation, url, client_id).await?,
        GifSource::GiphyId(id) => store.save_giphy(&conversation, id, client_id).await?,
    };
    Ok((StatusCode::CREATED, Json(message)))
}

async fn send_attachments(Extension(viewer): Extension<Viewer>, form: Multipart) -> SendResult {
    let input = SendAttachments::from_multipart(form).await?;
    let client_id = validate_client_id(&input.client_message_id)?;
    let conversation = conversation_for(viewer, &input.contact_id).await?;
    let message = message_store()
        .await?
        .save_attachments(&conversation, input.text, client_id, input.files)
        .await?;
    Ok((StatusCode::CREATED, Json(message)))
}

async fn get_gif(
    Extension(viewer): Extension<Viewer>,
    Path(message_id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    let message_id = parse_object_id(&message_id)?;
    message_store()
        .await?
        .gif_response(viewer.0, message_id, &headers)
        .await
}

async fn get_attachment(
    Extension(viewer): Extension<Viewer>,
    Path((message_id, file_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    let message_id = parse_object_id(&message_id)?;
    let file_id = parse_object_id(&file_id)?;
    message_store()
        .await?
        .attachment_response(viewer.0, message_id, file_id, &headers)
        .await
}

async fn read_gif_form(mut form: Multipart) -> Result<SendGif, StatusCode> {
    let mut contact_id = None;
    let mut client_message_id = None;
    let mut source = None;
    let invalid = StatusCode::BAD_REQUEST;

    while let Some(field) = form.next_field().await.map_err(|error| error.status())? {
        match field.name() {
            Some("contactId") if contact_id.is_none() => {
                contact_id = Some(read_gif_text(field, MAX_ID_FIELD_BYTES).await?);
            }
            Some("clientMessageId") if client_message_id.is_none() => {
                client_message_id = Some(read_gif_text(field, MAX_ID_FIELD_BYTES).await?);
            }
            Some("file") if source.is_none() => {
                let bytes = field.bytes().await.map_err(|error| error.status())?;
                source = Some(GifSource::File(bytes));
            }
            Some("url") if source.is_none() => {
                let url = read_gif_text(field, gif::MAX_GIF_URL_BYTES).await?;
                source = Some(GifSource::Url(url));
            }
            Some("giphyId") if source.is_none() => {
                let id = read_gif_text(field, MAX_ID_FIELD_BYTES).await?;
                source = Some(GifSource::GiphyId(id));
            }
            _ => return Err(invalid),
        }
    }

    Ok(SendGif {
        contact_id: contact_id.ok_or(invalid)?,
        client_message_id: client_message_id.ok_or(invalid)?,
        source: source.ok_or(invalid)?,
    })
}

async fn read_gif_text(field: Field<'_>, max_bytes: usize) -> Result<String, StatusCode> {
    if field.file_name().is_some() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let bytes = field.bytes().await.map_err(|error| error.status())?;
    if bytes.len() > max_bytes {
        return Err(StatusCode::BAD_REQUEST);
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| StatusCode::BAD_REQUEST)?;
    Ok(text.to_owned())
}

fn parse_object_id(value: &str) -> Result<ObjectId, StatusCode> {
    ObjectId::parse_str(value.trim()).map_err(|_| StatusCode::BAD_REQUEST)
}

fn validate_client_id(value: &str) -> Result<String, StatusCode> {
    let value = value.trim();
    if value.len() != 32 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(value.to_owned())
}