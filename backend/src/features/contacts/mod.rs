use axum::{
    Json, Router,
    extract::State,
    http::{StatusCode, header::CACHE_CONTROL},
    response::IntoResponse,
    routing::get,
};
use serde::{Deserialize, Serialize};
use tower_sessions::Session;

use super::auth::{MongoksyClient, session_token};

#[derive(Deserialize)]
struct MongoksyFollowing {
    items: Vec<MongoksyUser>,
}

#[derive(Deserialize)]
struct MongoksyUser {
    id: String,
    first_name: String,
    last_name: String,
    profile_image_url: Option<String>,
    profile_title: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Contact {
    id: String,
    name: String,
    avatar_url: Option<String>,
    profile_title: Option<String>,
}

#[derive(Serialize)]
struct ContactsResponse {
    contacts: Vec<Contact>,
}

pub(super) fn routes(client: Result<MongoksyClient, StatusCode>) -> Router {
    Router::new()
        .route("/api/contacts", get(get_contacts))
        .with_state(client)
}

async fn get_contacts(
    State(client): State<Result<MongoksyClient, StatusCode>>,
    session: Session,
) -> Result<impl IntoResponse, StatusCode> {
    let token = session_token(&session).await?;
    let client = client?;

    let following: MongoksyFollowing =
        match client.get_json("/api/follow/following", &token).await {
            Ok(following) => following,
            Err(status @ (StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN)) => {
                session
                    .flush()
                    .await
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

                return Err(status);
            }
            Err(status) => return Err(status),
        };

    let contacts = following
        .items
        .into_iter()
        .map(|user| {
            let full_name = format!("{} {}", user.first_name.trim(), user.last_name.trim());
            let name = full_name.trim();

            Contact {
                id: user.id,
                name: if name.is_empty() {
                    "Mongoksy user".to_owned()
                } else {
                    name.to_owned()
                },
                avatar_url: user.profile_image_url,
                profile_title: user.profile_title,
            }
        })
        .collect();

    Ok(([(CACHE_CONTROL, "no-store")], Json(ContactsResponse { contacts })))
}