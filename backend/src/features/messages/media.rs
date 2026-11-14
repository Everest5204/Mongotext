use std::iter;

use axum::{
    extract::{Multipart, multipart::Field},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};

use super::MAX_MESSAGE_LENGTH;

pub(super) const MAX_ATTACHMENT_TOTAL_BYTES: usize = 32 * 1024 * 1024;
pub(super) const MAX_ATTACHMENT_REQUEST_BYTES: usize = MAX_ATTACHMENT_TOTAL_BYTES + 64 * 1024;

const MAX_ATTACHMENTS: usize = 10;
const MAX_FILENAME_CHARS: usize = 255;
const MAX_ID_FIELD_BYTES: usize = 128;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum AttachmentKind {
    Image,
    Audio,
    Video,
}

pub(super) struct AttachmentUpload {
    pub(super) name: String,
    pub(super) kind: AttachmentKind,
    pub(super) mime_type: &'static str,
    pub(super) bytes: Vec<u8>,
}

pub(super) struct SendAttachments {
    pub(super) contact_id: String,
    pub(super) client_message_id: String,
    pub(super) text: String,
    pub(super) files: Vec<AttachmentUpload>,
}

impl SendAttachments {
    pub(super) async fn from_multipart(mut form: Multipart) -> Result<Self, StatusCode> {
        let mut contact_id = None;
        let mut client_message_id = None;
        let mut text = None;
        let mut files = Vec::new();
        let mut total_bytes = 0;

        while let Some(field) = form.next_field().await.map_err(|error| error.status())? {
            match field.name() {
                Some("contactId") if contact_id.is_none() => {
                    contact_id = Some(read_text(field, MAX_ID_FIELD_BYTES).await?);
                }
                Some("clientMessageId") if client_message_id.is_none() => {
                    client_message_id = Some(read_text(field, MAX_ID_FIELD_BYTES).await?);
                }
                Some("text") if text.is_none() => {
                    let value = read_text(field, MAX_MESSAGE_LENGTH * 4).await?;
                    let caption = value.trim();
                    if caption.chars().count() > MAX_MESSAGE_LENGTH {
                        return Err(StatusCode::BAD_REQUEST);
                    }
                    text = Some(caption.to_owned());
                }
                Some("files") => {
                    if files.len() >= MAX_ATTACHMENTS {
                        return Err(StatusCode::PAYLOAD_TOO_LARGE);
                    }

                    let name = attachment_name(field.file_name())?;
                    let bytes = read_field(field, MAX_ATTACHMENT_TOTAL_BYTES - total_bytes).await?;
                    if bytes.is_empty() {
                        return Err(StatusCode::UNPROCESSABLE_ENTITY);
                    }

                    let (kind, mime_type) =
                        media_type(&bytes).ok_or(StatusCode::UNSUPPORTED_MEDIA_TYPE)?;
                    total_bytes += bytes.len();
                    files.push(AttachmentUpload {
                        name,
                        kind,
                        mime_type,
                        bytes,
                    });
                }
                _ => return Err(StatusCode::BAD_REQUEST),
            }
        }

        if files.is_empty() {
            return Err(StatusCode::BAD_REQUEST);
        }

        Ok(Self {
            contact_id: contact_id.ok_or(StatusCode::BAD_REQUEST)?,
            client_message_id: client_message_id.ok_or(StatusCode::BAD_REQUEST)?,
            text: text.unwrap_or_default(),
            files,
        })
    }
}

fn attachment_name(filename: Option<&str>) -> Result<String, StatusCode> {
    let name = filename
        .and_then(|value| value.rsplit(['/', '\\']).next())
        .map(str::trim)
        .unwrap_or_default();
    if matches!(name, "" | "." | "..")
        || name.chars().count() > MAX_FILENAME_CHARS
        || name.chars().any(char::is_control)
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(name.to_owned())
}

async fn read_text(field: Field<'_>, max_bytes: usize) -> Result<String, StatusCode> {
    if field.file_name().is_some() {
        return Err(StatusCode::BAD_REQUEST);
    }
    String::from_utf8(read_field(field, max_bytes).await?).map_err(|_| StatusCode::BAD_REQUEST)
}

async fn read_field(mut field: Field<'_>, max_bytes: usize) -> Result<Vec<u8>, StatusCode> {
    let mut bytes = Vec::new();
    while let Some(chunk) = field.chunk().await.map_err(|error| error.status())? {
        if chunk.len() > max_bytes - bytes.len() {
            return Err(StatusCode::PAYLOAD_TOO_LARGE);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

type MediaType = (AttachmentKind, &'static str);

fn media_type(bytes: &[u8]) -> Option<MediaType> {
    use AttachmentKind::{Audio, Image};

    match bytes {
        [0xff, 0xd8, 0xff, _, ..] => Some((Image, "image/jpeg")),
        _ if bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.get(12..16) == Some(b"IHDR") => {
            Some((Image, "image/png"))
        }
        _ if bytes.len() > 13 && (bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) => {
            Some((Image, "image/gif"))
        }
        _ if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") => {
            Some((Image, "image/webp"))
        }
        _ if (bytes.starts_with(b"RIFF") || bytes.starts_with(b"RF64"))
            && bytes.get(8..12) == Some(b"WAVE") =>
        {
            Some((Audio, "audio/wav"))
        }
        _ if is_ogg_audio(bytes) => Some((Audio, "audio/ogg")),
        _ if is_mp3(bytes) => Some((Audio, "audio/mpeg")),
        _ if bytes.starts_with(b"\x1a\x45\xdf\xa3") => webm_media(bytes),
        _ => iso_media(bytes),
    }
}

fn is_ogg_audio(bytes: &[u8]) -> bool {
    if !bytes.starts_with(b"OggS\x00") {
        return false;
    }
    let Some(&segments) = bytes.get(26) else {
        return false;
    };
    if segments == 0 {
        return false;
    }
    let Some(packet) = bytes.get(27 + usize::from(segments)..) else {
        return false;
    };
    [b"OpusHead".as_slice(), b"\x01vorbis", b"\x7fFLAC", b"Speex   "]
        .iter()
        .any(|signature| packet.starts_with(signature))
}

fn is_mp3(mut bytes: &[u8]) -> bool {
    if bytes.starts_with(b"ID3") {
        let Some(size) = bytes.get(6..10) else {
            return false;
        };
        if size.iter().any(|byte| byte & 0x80 != 0) {
            return false;
        }
        let tag_size = size.iter().fold(0, |size, byte| (size << 7) | usize::from(*byte));
        let Some(after_tag) = bytes.get(10 + tag_size..) else {
            return false;
        };
        bytes = after_tag;
        if bytes.starts_with(b"3DI") {
            bytes = bytes.get(10..).unwrap_or_default();
        }
    }

    bytes.first_chunk::<4>().is_some_and(|header| {
        header[0] == 0xff
            && header[1] & 0xe0 == 0xe0
            && header[1] & 0x18 != 0x08
            && header[1] & 0x06 == 0x02
            && header[2] >> 4 != 15
            && header[2] & 0x0c != 0x0c
    })
}

fn iso_media(bytes: &[u8]) -> Option<MediaType> {
    use AttachmentKind::{Audio, Image, Video};

    let first_type = bytes.get(4..8)?;
    if !matches!(first_type, b"ftyp" | b"free" | b"skip" | b"wide" | b"moov" | b"mdat") {
        return None;
    }

    let file_type = find_iso_box(bytes, b"ftyp");
    let quicktime = match file_type {
        Some(file_type) => {
            let major = file_type.get(..4)?;
            let brands = iter::once(major).chain(file_type.get(8..)?.chunks_exact(4));
            if brands.clone().any(|brand| matches!(brand, b"avif" | b"avis")) {
                return Some((Image, "image/avif"));
            }

            let quicktime = major == b"qt  ";
            let mp4 = brands.clone().any(|brand| {
                brand.starts_with(b"iso")
                    || brand.starts_with(b"mp4")
                    || matches!(brand, b"avc1" | b"hvc1" | b"hev1" | b"av01" | b"M4A " | b"M4V ")
                    || matches!(brand, b"dash" | b"cmfc" | b"cmfs" | b"MSNV")
            });
            if !quicktime && !mp4 {
                return None;
            }
            quicktime
        }
        None => true,
    };

    let movie = find_iso_box(bytes, b"moov")?;
    let mut has_audio = false;
    for (box_type, track) in iso_boxes(movie) {
        if &box_type != b"trak" {
            continue;
        }
        let handler = find_iso_box(track, b"mdia")
            .and_then(|media| find_iso_box(media, b"hdlr"))
            .and_then(|handler| handler.get(8..12));
        match handler {
            Some(b"vide") => {
                let mime = if quicktime { "video/quicktime" } else { "video/mp4" };
                return Some((Video, mime));
            }
            Some(b"soun") => has_audio = true,
            _ => {}
        }
    }

    let mime = if quicktime { "video/quicktime" } else { "audio/mp4" };
    has_audio.then_some((Audio, mime))
}

fn find_iso_box<'a>(bytes: &'a [u8], target: &[u8; 4]) -> Option<&'a [u8]> {
    iso_boxes(bytes).find_map(|(kind, payload)| (&kind == target).then_some(payload))
}

fn iso_boxes(mut bytes: &[u8]) -> impl Iterator<Item = ([u8; 4], &[u8])> {
    iter::from_fn(move || {
        let size = u32::from_be_bytes(*bytes.first_chunk::<4>()?);
        let kind = bytes.get(4..8)?.try_into().ok()?;
        let (size, header) = match size {
            0 => (bytes.len(), 8),
            1 => {
                let size = u64::from_be_bytes(bytes.get(8..16)?.try_into().ok()?);
                (usize::try_from(size).ok()?, 16)
            }
            size => (usize::try_from(size).ok()?, 8),
        };
        let payload = bytes.get(header..size)?;
        bytes = &bytes[size..];
        Some((kind, payload))
    })
}

fn webm_media(bytes: &[u8]) -> Option<MediaType> {
    use AttachmentKind::{Audio, Video};

    let header = find_ebml_element(bytes, 0x1a45dfa3)?;
    if find_ebml_element(header, 0x4282)? != b"webm" {
        return None;
    }

    let segment = find_ebml_element(bytes, 0x18538067)?;
    let tracks = find_ebml_element(segment, 0x1654ae6b)?;
    let mut has_audio = false;
    for (id, track) in ebml_elements(tracks) {
        if id != 0xae {
            continue;
        }
        let Some(value) = find_ebml_element(track, 0x83) else {
            continue;
        };
        let Some((&track_type, prefix)) = value.split_last() else {
            continue;
        };
        if !prefix.iter().all(|byte| *byte == 0) {
            continue;
        }
        match track_type {
            1 => return Some((Video, "video/webm")),
            2 => has_audio = true,
            _ => {}
        }
    }

    has_audio.then_some((Audio, "audio/webm"))
}

fn find_ebml_element(bytes: &[u8], target: u64) -> Option<&[u8]> {
    ebml_elements(bytes).find_map(|(id, payload)| (id == target).then_some(payload))
}

fn ebml_elements(mut bytes: &[u8]) -> impl Iterator<Item = (u64, &[u8])> {
    iter::from_fn(move || {
        let (id, _) = read_ebml_number(&mut bytes, false)?;
        let (size, width) = read_ebml_number(&mut bytes, true)?;
        let unknown_size = (1_u64 << (7 * width)) - 1;
        let size = if size == unknown_size {
            bytes.len()
        } else {
            usize::try_from(size).ok()?
        };
        let (payload, remaining) = bytes.split_at_checked(size)?;
        bytes = remaining;
        Some((id, payload))
    })
}

fn read_ebml_number(bytes: &mut &[u8], strip_marker: bool) -> Option<(u64, u32)> {
    let first = *bytes.first()?;
    let width = first.leading_zeros() + 1;
    if width > 8 {
        return None;
    }

    let (encoded, remaining) = bytes.split_at_checked(width as usize)?;
    let first = if strip_marker {
        u64::from(first) & ((1_u64 << (8 - width)) - 1)
    } else {
        u64::from(first)
    };
    let value = encoded[1..].iter().fold(first, |value, byte| (value << 8) | u64::from(*byte));
    *bytes = remaining;
    Some((value, width))
}