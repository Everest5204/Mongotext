use axum::{Router, routing::get};

pub fn routes() -> Router {
    Router::new().route("/health", get(health))
}

async fn health() -> &'static str {
    "ok"
}
