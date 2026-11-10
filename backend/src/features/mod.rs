use tower_sessions::{
    Expiry, MemoryStore, SessionManagerLayer,
    cookie::{SameSite, time::Duration},
};

mod auth;
mod contacts;
mod health;

pub fn routes() -> axum::Router {
    let client = auth::MongoksyClient::from_env();

    let session_layer = SessionManagerLayer::new(MemoryStore::default())
        .with_name("mongotext_session")
        .with_http_only(true)
        .with_same_site(SameSite::Strict)
        .with_secure(false)
        .with_expiry(Expiry::OnInactivity(Duration::hours(8)));

    let session_routes = auth::routes(client.clone())
        .merge(contacts::routes(client))
        .layer(session_layer);

    health::routes().merge(session_routes)
}