use std::{env, time::Duration};

use axum::http::StatusCode;
use mongodb::{
    Client, Collection,
    bson::{Document, doc, oid::ObjectId},
    options::ClientOptions,
};
use serde::Deserialize;
use tokio::sync::OnceCell;

const PAGE_SIZE: usize = 50;
static USERS: OnceCell<Collection<DirectoryUser>> = OnceCell::const_new();

#[derive(Deserialize)]
pub(super) struct DirectoryUser {
    #[serde(rename = "_id")]
    pub(super) id: ObjectId,
    pub(super) first_name: Option<String>,
    pub(super) last_name: Option<String>,
    pub(super) profile_image_url: Option<String>,
    pub(super) profile_title: Option<String>,
}

pub(super) struct DirectoryPage {
    pub(super) users: Vec<DirectoryUser>,
    pub(super) next_cursor: Option<String>,
}

async fn users_collection() -> Result<&'static Collection<DirectoryUser>, StatusCode> {
    USERS
        .get_or_try_init(|| async {
            let unavailable = StatusCode::SERVICE_UNAVAILABLE;
            let uri = env::var("MONGOKSY_DIRECTORY_MONGODB_URI").map_err(|_| unavailable)?;
            let db_name = env::var("MONGOKSY_DIRECTORY_DB_NAME").map_err(|_| unavailable)?;

            if uri.trim().is_empty() || db_name.trim().is_empty() {
                return Err(unavailable);
            }

            let mut options = ClientOptions::parse(uri.trim())
                .await
                .map_err(|_| unavailable)?;
            options.server_selection_timeout = Some(Duration::from_secs(4));

            let client = Client::with_options(options).map_err(|_| unavailable)?;
            Ok(client.database(db_name.trim()).collection("users"))
        })
        .await
}

fn active_users_filter() -> Document {
    doc! {
        "deactivated": { "$ne": true },
        "deletion_requested": { "$ne": true },
    }
}

pub(super) async fn contains_user(id: ObjectId) -> Result<bool, StatusCode> {
    let mut filter = active_users_filter();
    filter.insert("_id", id);

    let user = users_collection()
        .await?
        .find_one(filter)
        .projection(doc! { "_id": 1 })
        .max_time(Duration::from_secs(2))
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;

    Ok(user.is_some())
}

pub(super) async fn list_users(after: Option<&str>) -> Result<DirectoryPage, StatusCode> {
    let mut filter = active_users_filter();

    if let Some(after) = after {
        let id = ObjectId::parse_str(after).map_err(|_| StatusCode::BAD_REQUEST)?;
        filter.insert("_id", doc! { "$lt": id });
    }

    let collection = users_collection().await?;
    let mut cursor = collection
        .find(filter)
        .sort(doc! { "_id": -1 })
        .limit((PAGE_SIZE + 1) as i64)
        .projection(doc! {
            "_id": 1,
            "first_name": 1,
            "last_name": 1,
            "profile_image_url": 1,
            "profile_title": 1,
        })
        .max_time(Duration::from_secs(2))
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;

    let mut users = Vec::with_capacity(PAGE_SIZE + 1);
    while cursor.advance().await.map_err(|_| StatusCode::BAD_GATEWAY)? {
        users.push(
            cursor
                .deserialize_current()
                .map_err(|_| StatusCode::BAD_GATEWAY)?,
        );
    }

    let next_cursor = if users.len() > PAGE_SIZE {
        users.truncate(PAGE_SIZE);
        users.last().map(|user| user.id.to_hex())
    } else {
        None
    };

    Ok(DirectoryPage { users, next_cursor })
}