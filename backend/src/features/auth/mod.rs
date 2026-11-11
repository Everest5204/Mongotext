use std::{env, time::Duration};

use axum::{
    Json, Router,
    extract::State,
    http::{
        HeaderMap, StatusCode,
        header::{CACHE_CONTROL, HOST, ORIGIN},
    },
    response::IntoResponse,
    routing::{get, post},
};
use reqwest::{Client, RequestBuilder, Url, header::ACCEPT, redirect::Policy};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use tower_sessions::Session;

const ACCESS_TOKEN_KEY: &str = "mongoksy_access_token";

#[derive(Clone)]
pub(super) struct MongoksyClient {
    http: Client,
    base_url: Url,
}

#[derive(Deserialize, Serialize)]
struct LoginRequest {
    email_or_phone: String,
    password: String,
}

#[derive(Deserialize)]
struct MongoksyLoginResponse {
    token: String,
}

pub(super) fn routes(client: Result<MongoksyClient, StatusCode>) -> Router {
    Router::new()
        .route("/api/session", get(session_status))
        .route("/api/session/login", post(login))
        .with_state(client)
}

async fn login(
    State(client): State<Result<MongoksyClient, StatusCode>>,
    session: Session,
    headers: HeaderMap,
    Json(mut credentials): Json<LoginRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    if !same_local_origin(&headers) {
        return Err(StatusCode::FORBIDDEN);
    }

    credentials.email_or_phone = credentials.email_or_phone.trim().to_owned();

    if credentials.email_or_phone.is_empty() || credentials.password.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let token = client?.sign_in(&credentials).await?;

    session
        .cycle_id()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    session
        .insert(ACCESS_TOKEN_KEY, token)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(([(CACHE_CONTROL, "no-store")], StatusCode::NO_CONTENT))
}

async fn session_status(session: Session) -> Result<impl IntoResponse, StatusCode> {
    session_token(&session).await?;
    Ok(([(CACHE_CONTROL, "no-store")], StatusCode::NO_CONTENT))
}

pub(super) async fn session_token(session: &Session) -> Result<String, StatusCode> {
    session
        .get::<String>(ACCESS_TOKEN_KEY)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::UNAUTHORIZED)
}

impl MongoksyClient {
    pub(super) fn from_env() -> Result<Self, StatusCode> {
        let unavailable = StatusCode::SERVICE_UNAVAILABLE;

        if !cfg!(debug_assertions) {
            return Err(unavailable);
        }

        let api_url = env::var("MONGOKSY_API_BASE_URL").map_err(|_| unavailable)?;
        let base_url = Url::parse(api_url.trim()).map_err(|_| unavailable)?;

        let allowed_origin = matches!(
            (base_url.scheme(), base_url.host_str()),
            ("https", Some(_)) | ("http", Some("localhost" | "127.0.0.1" | "[::1]"))
        );

        if !allowed_origin
            || base_url.path() != "/"
            || base_url.query().is_some()
            || base_url.fragment().is_some()
            || !base_url.username().is_empty()
            || base_url.password().is_some()
        {
            return Err(unavailable);
        }

        let mut builder = Client::builder()
            .timeout(Duration::from_secs(30))
            .redirect(Policy::none());

        if base_url.scheme() == "http" {
            builder = builder.no_proxy();
        }

        let http = builder.build().map_err(|_| unavailable)?;

        Ok(Self { http, base_url })
    }

    async fn sign_in(&self, credentials: &LoginRequest) -> Result<String, StatusCode> {
        let request = self
            .http
            .post(self.endpoint("/api/auth/login"))
            .json(credentials);

        let result: MongoksyLoginResponse = request_json(request).await?;
        let token = result.token.trim();

        if token.is_empty() {
            return Err(StatusCode::BAD_GATEWAY);
        }

        Ok(token.to_owned())
    }

    pub(super) async fn get_json<T: DeserializeOwned>(
        &self,
        path: &str,
        access_token: &str,
    ) -> Result<T, StatusCode> {
        self.get_json_with_query(path, access_token, &[]).await
    }

    pub(super) async fn get_json_with_query<T: DeserializeOwned>(
        &self,
        path: &str,
        access_token: &str,
        query: &[(&str, &str)],
    ) -> Result<T, StatusCode> {
        let mut url = self.endpoint(path);

        if !query.is_empty() {
            url.query_pairs_mut().extend_pairs(query.iter().copied());
        }

        let request = self.http.get(url).bearer_auth(access_token);
        request_json(request).await
    }

    fn endpoint(&self, path: &str) -> Url {
        let mut url = self.base_url.clone();
        url.set_path(path);
        url
    }
}

async fn request_json<T: DeserializeOwned>(request: RequestBuilder) -> Result<T, StatusCode> {
    let response = request
        .header(ACCEPT, "application/json")
        .send()
        .await
        .map_err(upstream_error)?;

    match response.status() {
        status @ (StatusCode::UNAUTHORIZED
        | StatusCode::FORBIDDEN
        | StatusCode::TOO_MANY_REQUESTS) => Err(status),
        status if status.is_success() => response.json::<T>().await.map_err(upstream_error),
        _ => Err(StatusCode::BAD_GATEWAY),
    }
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

fn upstream_error(error: reqwest::Error) -> StatusCode {
    if error.is_timeout() {
        StatusCode::GATEWAY_TIMEOUT
    } else {
        StatusCode::BAD_GATEWAY
    }
}