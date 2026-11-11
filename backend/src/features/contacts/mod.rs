mod directory;

use axum::{
    Json, Router,
    extract::{Query, State},
    http::{StatusCode, header::CACHE_CONTROL},
    response::IntoResponse,
    routing::get,
};
use serde::{Deserialize, Serialize, de::IgnoredAny};
use tower_sessions::Session;

use super::auth::{MongoksyClient, session_token};

#[derive(Deserialize)]
struct ContactsQuery {
    q: Option<String>,
    cursor: Option<String>,
}

#[derive(Deserialize)]
struct MongoksySearch {
    users: Option<Vec<MongoksyUser>>,
}

#[derive(Deserialize)]
struct MongoksyUser {
    id: Option<String>,
    #[serde(rename = "_id")]
    legacy_id: Option<String>,
    #[serde(alias = "firstName")]
    first_name: Option<String>,
    #[serde(alias = "lastName")]
    last_name: Option<String>,
    #[serde(alias = "profileImageURL")]
    profile_image_url: Option<String>,
    #[serde(alias = "profileTitle")]
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

impl Contact {
    fn from_profile(
        id: String,
        first_name: Option<String>,
        last_name: Option<String>,
        avatar_url: Option<String>,
        profile_title: Option<String>,
    ) -> Self {
        let first_name = first_name.as_deref().unwrap_or_default().trim();
        let last_name = last_name.as_deref().unwrap_or_default().trim();
        let full_name = format!("{first_name} {last_name}");
        let name = full_name.trim();

        Self {
            id,
            name: if name.is_empty() {
                "Mongoksy user".to_owned()
            } else {
                name.to_owned()
            },
            avatar_url,
            profile_title,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ContactsResponse {
    contacts: Vec<Contact>,
    next_cursor: Option<String>,
}

pub(super) fn routes(client: Result<MongoksyClient, StatusCode>) -> Router {
    Router::new()
        .route("/api/contacts", get(get_contacts))
        .with_state(client)
}

async fn get_contacts(
    State(client): State<Result<MongoksyClient, StatusCode>>,
    Query(query): Query<ContactsQuery>,
    session: Session,
) -> Result<impl IntoResponse, StatusCode> {
    let token = session_token(&session).await?;
    let client = client?;

    match load_contacts(&client, &token, query).await {
        Ok(page) => Ok(([(CACHE_CONTROL, "no-store")], Json(page))),
        Err(status @ (StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN)) => {
            session
                .flush()
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            Err(status)
        }
        Err(status) => Err(status),
    }
}

async fn load_contacts(
    client: &MongoksyClient,
    token: &str,
    query: ContactsQuery,
) -> Result<ContactsResponse, StatusCode> {
    let term = query.q.as_deref().unwrap_or_default().trim();

    if term.is_empty() {
        client.get_json::<IgnoredAny>("/api/user/me", token).await?;
        let page = directory::list_users(query.cursor.as_deref()).await?;

        return Ok(ContactsResponse {
            contacts: page
                .users
                .into_iter()
                .map(|user| {
                    Contact::from_profile(
                        user.id.to_hex(),
                        user.first_name,
                        user.last_name,
                        user.profile_image_url,
                        user.profile_title,
                    )
                })
                .collect(),
            next_cursor: page.next_cursor,
        });
    }

    let result: MongoksySearch = client
        .get_json_with_query("/api/search/users", token, &[("q", term), ("limit", "20")])
        .await?;

    let contacts = result
        .users
        .unwrap_or_default()
        .into_iter()
        .filter_map(|user| {
            let id = user.id.or(user.legacy_id).filter(|id| !id.is_empty())?;
            Some(Contact::from_profile(
                id,
                user.first_name,
                user.last_name,
                user.profile_image_url,
                user.profile_title,
            ))
        })
        .collect();

    Ok(ContactsResponse {
        contacts,
        next_cursor: None,
    })
}