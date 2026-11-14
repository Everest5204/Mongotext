use std::{io, time::Duration};

use axum::{
    body::{Body, Bytes},
    http::{
        HeaderMap, HeaderName, StatusCode,
        header::{
            ACCEPT_RANGES, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, IF_RANGE,
            RANGE, X_CONTENT_TYPE_OPTIONS,
        },
    },
    response::{IntoResponse, Response},
};
use futures_util::{TryStreamExt, io::AsyncWriteExt};
use mongodb::{
    Collection, Database,
    bson::{Binary, Bson, doc, oid::ObjectId},
    gridfs::{FilesCollectionDocument, GridFsBucket},
    options::GridFsBucketOptions,
};
use serde::{Deserialize, Serialize};

use super::media::{AttachmentKind, AttachmentUpload, MAX_ATTACHMENT_TOTAL_BYTES};

const BUCKET_NAME: &str = "message_media";
const WRITE_BUFFER_BYTES: usize = 4 * 1024 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(4);
const PRIVATE_NO_STORE: &str = "private, no-store";

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct StoredAttachment {
    pub(super) id: ObjectId,
    pub(super) kind: AttachmentKind,
    pub(super) name: String,
    pub(super) mime_type: String,
    pub(super) size_bytes: u32,
}

#[derive(Deserialize)]
struct MediaChunk {
    n: u32,
    data: Binary,
}

pub(super) struct MediaStore {
    bucket: GridFsBucket,
    chunks: Collection<MediaChunk>,
}

impl MediaStore {
    pub(super) fn new(database: &Database) -> Self {
        Self {
            bucket: database.gridfs_bucket(
                GridFsBucketOptions::builder()
                    .bucket_name(BUCKET_NAME.to_owned())
                    .build(),
            ),
            chunks: database.collection(&format!("{BUCKET_NAME}.chunks")),
        }
    }

    pub(super) async fn upload(
        &self,
        files: &[AttachmentUpload],
    ) -> Result<Vec<StoredAttachment>, StatusCode> {
        let mut saved = Vec::with_capacity(files.len());
        for file in files {
            match self.upload_one(file).await {
                Ok(attachment) => saved.push(attachment),
                Err(status) => {
                    self.discard(&saved).await;
                    return Err(status);
                }
            }
        }
        Ok(saved)
    }

    async fn upload_one(&self, file: &AttachmentUpload) -> Result<StoredAttachment, StatusCode> {
        let id = ObjectId::new();
        let mut stream = self
            .bucket
            .open_upload_stream(&file.name)
            .id(Bson::ObjectId(id))
            .await
            .map_err(storage_error)?;
        let result = async {
            for bytes in file.bytes.chunks(WRITE_BUFFER_BYTES) {
                stream.write_all(bytes).await?;
            }
            stream.close().await
        }
        .await;
        if result.is_err() {
            self.delete(id).await;
            return Err(StatusCode::SERVICE_UNAVAILABLE);
        }

        Ok(StoredAttachment {
            id,
            kind: file.kind,
            name: file.name.clone(),
            mime_type: file.mime_type.to_owned(),
            size_bytes: file.bytes.len() as u32,
        })
    }

    pub(super) async fn discard(&self, files: &[StoredAttachment]) {
        for file in files {
            self.delete(file.id).await;
        }
    }

    async fn delete(&self, id: ObjectId) {
        if let Err(error) = self.bucket.delete(Bson::ObjectId(id)).await {
            use mongodb::error::{ErrorKind, GridFsErrorKind};
            if !matches!(
                error.kind.as_ref(),
                ErrorKind::GridFs(GridFsErrorKind::FileNotFound { .. })
            ) {
                eprintln!("Could not remove unpublished media {id}: {error}");
            }
        }
    }

    // The message store authorizes access before passing an attachment here.
    pub(super) async fn response(
        &self,
        attachment: &StoredAttachment,
        headers: &HeaderMap,
    ) -> Result<Response, StatusCode> {
        let file = self.file_info(attachment).await?;
        let length = file.length;
        let chunk_size = u64::from(file.chunk_size_bytes);
        let range = match ByteRange::from_headers(headers, length) {
            Ok(range) => range,
            Err(()) => {
                return Ok((
                    StatusCode::RANGE_NOT_SATISFIABLE,
                    [
                        (ACCEPT_RANGES, "bytes".to_owned()),
                        (CACHE_CONTROL, PRIVATE_NO_STORE.to_owned()),
                        (CONTENT_RANGE, format!("bytes */{length}")),
                    ],
                )
                    .into_response());
            }
        };

        let mut chunks = self
            .chunks
            .find(doc! {
                "files_id": attachment.id,
                "n": {
                    "$gte": (range.start / chunk_size) as i64,
                    "$lte": (range.end / chunk_size) as i64,
                },
            })
            .sort(doc! { "n": 1 })
            .projection(doc! { "_id": 0, "n": 1, "data": 1 })
            .batch_size(4)
            .max_time(READ_TIMEOUT)
            .await
            .map_err(storage_error)?;

        let content_length = range.end - range.start + 1;
        let stream = async_stream::try_stream! {
            let mut position = range.start;
            while position <= range.end {
                let chunk = tokio::time::timeout(READ_TIMEOUT, chunks.try_next())
                    .await
                    .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "GridFS read timed out"))?
                    .map_err(io::Error::other)?
                    .ok_or_else(invalid_chunk)?;

                let index = position / chunk_size;
                let chunk_start = index * chunk_size;
                let expected_size = chunk_size.min(length - chunk_start);
                if u64::from(chunk.n) != index || chunk.data.bytes.len() as u64 != expected_size {
                    Err(invalid_chunk())?;
                }

                let start = (position - chunk_start) as usize;
                let end = (range.end + 1 - chunk_start).min(expected_size) as usize;
                position = chunk_start + end as u64;
                yield Bytes::from(chunk.data.bytes).slice(start..end);
            }
        };
        let body = Body::from_stream(stream.map_err(|error: io::Error| error));

        let mut response = (
            [
                (ACCEPT_RANGES, "bytes".to_owned()),
                (CACHE_CONTROL, PRIVATE_NO_STORE.to_owned()),
                (CONTENT_LENGTH, content_length.to_string()),
                (CONTENT_TYPE, attachment.mime_type.clone()),
                (X_CONTENT_TYPE_OPTIONS, "nosniff".to_owned()),
                (
                    HeaderName::from_static("cross-origin-resource-policy"),
                    "same-origin".to_owned(),
                ),
            ],
            body,
        )
            .into_response();
        if range.partial {
            *response.status_mut() = StatusCode::PARTIAL_CONTENT;
            response.headers_mut().insert(
                CONTENT_RANGE,
                format!("bytes {}-{}/{length}", range.start, range.end)
                    .parse()
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
            );
        }
        Ok(response)
    }

    async fn file_info(
        &self,
        attachment: &StoredAttachment,
    ) -> Result<FilesCollectionDocument, StatusCode> {
        let file = self
            .bucket
            .find_one(doc! { "_id": attachment.id })
            .max_time(READ_TIMEOUT)
            .await
            .map_err(storage_error)?
            .ok_or(StatusCode::NOT_FOUND)?;
        if file.length == 0
            || file.length > MAX_ATTACHMENT_TOTAL_BYTES as u64
            || file.length != u64::from(attachment.size_bytes)
            || file.chunk_size_bytes == 0
        {
            return Err(StatusCode::SERVICE_UNAVAILABLE);
        }
        Ok(file)
    }
}

#[derive(Clone, Copy)]
struct ByteRange {
    start: u64,
    end: u64,
    partial: bool,
}

impl ByteRange {
    fn from_headers(headers: &HeaderMap, length: u64) -> Result<Self, ()> {
        let full = Self {
            start: 0,
            end: length - 1,
            partial: false,
        };
        if headers.contains_key(IF_RANGE) {
            return Ok(full);
        }

        let mut values = headers.get_all(RANGE).iter();
        let Some(value) = values.next() else {
            return Ok(full);
        };
        let value = value.to_str().map_err(|_| ())?;
        let Some((unit, value)) = value.split_once('=') else {
            return Err(());
        };
        if !unit.eq_ignore_ascii_case("bytes") || value.contains(',') || values.next().is_some() {
            return Ok(full);
        }

        let (first, last) = value.trim().split_once('-').ok_or(())?;
        let (start, end) = if first.is_empty() {
            let count = byte_number(last)?;
            if count == 0 {
                return Err(());
            }
            (length.saturating_sub(count), length - 1)
        } else {
            let start = byte_number(first)?;
            let end = if last.is_empty() {
                length - 1
            } else {
                byte_number(last)?.min(length - 1)
            };
            if start > end {
                return Err(());
            }
            (start, end)
        };

        Ok(Self {
            start,
            end,
            partial: true,
        })
    }
}

fn byte_number(value: &str) -> Result<u64, ()> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(());
    }
    Ok(value.bytes().fold(0_u64, |number, byte| {
        number.saturating_mul(10).saturating_add(u64::from(byte - b'0'))
    }))
}

fn invalid_chunk() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "GridFS attachment chunk is missing or invalid")
}

fn storage_error(_: mongodb::error::Error) -> StatusCode {
    StatusCode::SERVICE_UNAVAILABLE
}