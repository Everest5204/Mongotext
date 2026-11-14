use std::time::Duration;

use axum::{
    body::{Body, Bytes},
    http::header::{CACHE_CONTROL, CONTENT_TYPE},
    response::{IntoResponse, Response},
};
use serde::Serialize;
use tokio::sync::broadcast::{self, error::RecvError};

use super::store::{Change, Conversation, MessagePage, MessageView};

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Frame {
    Snapshot { page: MessagePage },
    Message { message: MessageView },
}

pub(super) fn response(
    conversation: Conversation,
    snapshot: MessagePage,
    mut changes: broadcast::Receiver<Change>,
) -> Response {
    let frames = async_stream::stream! {
        yield line(Frame::Snapshot { page: snapshot });

        let mut heartbeat = tokio::time::interval(Duration::from_secs(15));
        heartbeat.tick().await;
        let expires = tokio::time::sleep(Duration::from_secs(10 * 60));
        tokio::pin!(expires);

        loop {
            tokio::select! {
                _ = &mut expires => break,
                _ = heartbeat.tick() => yield Ok(Bytes::from_static(b"\n")),
                change = changes.recv() => match change {
                    Ok(Change::Saved(message)) if message.conversation_key == conversation.key => {
                        yield line(Frame::Message { message: message.view(conversation.viewer) });
                    }
                    Ok(Change::Saved(_)) => {}
                    Ok(Change::Refresh) | Err(RecvError::Lagged(_) | RecvError::Closed) => break,
                },
            }
        }
    };

    (
        [
            (CONTENT_TYPE, "application/x-ndjson"),
            (CACHE_CONTROL, "no-store, no-transform"),
            (
                axum::http::HeaderName::from_static("x-accel-buffering"),
                "no",
            ),
        ],
        Body::from_stream(frames),
    )
        .into_response()
}

fn line(frame: Frame) -> Result<Bytes, serde_json::Error> {
    let mut bytes = serde_json::to_vec(&frame)?;
    bytes.push(b'\n');
    Ok(Bytes::from(bytes))
}