use axum::{body::Bytes, http::StatusCode};
use gif::{DecodeOptions, MemoryLimit};
use reqwest::Url;

pub(super) const MAX_GIF_BYTES: usize = 2 * 1024 * 1024;
pub(super) const MAX_GIF_URL_BYTES: usize = 2_048;

const MAX_GIPHY_ID_BYTES: usize = 128;
const MAX_GIF_SIDE: u16 = 1_024;
const MAX_GIF_FRAMES: usize = 300;
const MAX_DECODED_PIXELS: u64 = 32_000_000;

pub(super) struct GifUpload {
    pub(super) bytes: Vec<u8>,
    pub(super) width: u16,
    pub(super) height: u16,
}

pub(super) async fn validate_upload(bytes: Bytes) -> Result<GifUpload, StatusCode> {
    if bytes.len() > MAX_GIF_BYTES {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }

    tokio::task::spawn_blocking(move || {
        let (width, height) = gif_dimensions(&bytes)?;
        Ok(GifUpload {
            bytes: bytes.to_vec(),
            width,
            height,
        })
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
}

fn gif_dimensions(bytes: &[u8]) -> Result<(u16, u16), StatusCode> {
    let invalid = StatusCode::UNSUPPORTED_MEDIA_TYPE;
    if !bytes.starts_with(b"GIF87a") && !bytes.starts_with(b"GIF89a") {
        return Err(invalid);
    }

    let mut options = DecodeOptions::new();
    options.set_memory_limit(MemoryLimit::Bytes(
        (u64::from(MAX_GIF_SIDE).pow(2))
            .try_into()
            .expect("GIF frame limit is nonzero"),
    ));
    options.check_frame_consistency(true);
    let mut decoder = options.read_info(bytes).map_err(|_| invalid)?;
    let (width, height) = (decoder.width(), decoder.height());
    if width == 0 || height == 0 || width > MAX_GIF_SIDE || height > MAX_GIF_SIDE {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }

    let mut frames = 0;
    let mut decoded_pixels = 0;
    while let Some(frame) = decoder.read_next_frame().map_err(|_| invalid)? {
        frames += 1;
        decoded_pixels += u64::from(frame.width) * u64::from(frame.height);
        if frames > MAX_GIF_FRAMES || decoded_pixels > MAX_DECODED_PIXELS {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }

    if frames == 0 {
        return Err(invalid);
    }
    Ok((width, height))
}

pub(super) fn validate_giphy_id(value: &str) -> Result<String, StatusCode> {
    let id = value.trim();
    if id.is_empty()
        || id.len() > MAX_GIPHY_ID_BYTES
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err(StatusCode::BAD_REQUEST);
    }

    Ok(id.to_owned())
}

pub(super) fn validate_giphy_url(value: &str) -> Result<String, StatusCode> {
    let value = value.trim();
    if value.len() > MAX_GIF_URL_BYTES {
        return Err(StatusCode::BAD_REQUEST);
    }

    let url = Url::parse(value).map_err(|_| StatusCode::BAD_REQUEST)?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.fragment().is_some()
        || !url.host_str().is_some_and(is_giphy_media_host)
        || !url.path().ends_with(".gif")
    {
        return Err(StatusCode::BAD_REQUEST);
    }

    Ok(url.into())
}

fn is_giphy_media_host(host: &str) -> bool {
    host == "i.giphy.com"
        || host
            .strip_prefix("media")
            .and_then(|suffix| suffix.strip_suffix(".giphy.com"))
            .is_some_and(|number| number.bytes().all(|byte| byte.is_ascii_digit()))
}