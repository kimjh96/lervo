//! The images a session's messages carried, kept beside its conversation index under their
//! identity, the SHA-256 of their bytes (sessions specification, "Images in a message"). The
//! index keeps only each image's mark; `image.read` returns the bytes. A rebuild of the index keeps
//! them, and the cap on all indexes counts them.

use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use lervo_session_core::ports::SentImage;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

/// The prefix of an image file, which a rebuild of the index keeps.
pub(crate) const PREFIX: &str = "img-";

const FORMATS: [(&str, &str); 4] = [
    ("image/png", "png"),
    ("image/jpeg", "jpg"),
    ("image/gif", "gif"),
    ("image/webp", "webp"),
];

fn extension(media_type: &str) -> Option<&'static str> {
    FORMATS
        .iter()
        .find(|(media, _)| *media == media_type)
        .map(|(_, extension)| *extension)
}

/// Images one message carries at most, and Base64 characters one image holds at most, as the
/// protocol bounds `session.send`'s images.
const MAX_IMAGES: usize = 3;
const MAX_IMAGE_CHARACTERS: usize = 240_000;

/// Takes the images pasted with `workspace.start`'s instruction out of its arguments, so the core
/// receives the text alone and the session host sends the images with the first message. Images
/// outside the protocol's bounds are dropped.
pub(crate) fn take(arguments: &mut Map<String, Value>) -> Vec<SentImage> {
    let Some(Value::Array(images)) = arguments.remove("images") else {
        return Vec::new();
    };
    images
        .iter()
        .filter_map(|image| {
            let media_type = image.get("mediaType")?.as_str()?;
            let data = image.get("data")?.as_str()?;
            (extension(media_type).is_some()
                && !data.is_empty()
                && data.len() <= MAX_IMAGE_CHARACTERS)
                .then(|| SentImage {
                    media_type: media_type.to_owned(),
                    data: data.to_owned(),
                })
        })
        .take(MAX_IMAGES)
        .collect()
}

/// The identity of an image: the SHA-256 of its bytes, in lowercase hex.
fn identity(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn path(directory: &Path, id: &str, extension: &str) -> PathBuf {
    directory.join(format!("{PREFIX}{id}.{extension}"))
}

/// Keeps each image in `directory` under its identity. An image already kept is left as it is;
/// one that cannot be decoded or written is skipped, and its message still goes.
pub(crate) fn keep(directory: &Path, images: &[SentImage]) {
    for image in images {
        let (Some(extension), Ok(bytes)) = (
            extension(&image.media_type),
            STANDARD.decode(image.data.as_bytes()),
        ) else {
            continue;
        };
        let target = path(directory, &identity(&bytes), extension);
        if !target.exists() {
            let _ = fs::write(&target, &bytes);
        }
    }
}

/// The media type and Base64 bytes of the image `id` kept in `directory`, if any. `id` is the
/// protocol's 64 hex digits, so it never leaves the directory.
pub(crate) fn read(directory: &Path, id: &str) -> Option<(&'static str, String)> {
    if id.len() != 64 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    FORMATS.iter().find_map(|(media, extension)| {
        fs::read(path(directory, id, extension))
            .ok()
            .map(|bytes| (*media, STANDARD.encode(bytes)))
    })
}

#[cfg(test)]
mod tests {
    use super::{identity, keep, read, take};
    use lervo_session_core::ports::SentImage;
    use serde_json::json;

    #[test]
    fn takes_the_instructions_images_out_of_the_start_arguments() {
        let mut arguments = json!({
            "instruction": "Fix the sign-in hint",
            "images": [
                {"mediaType": "image/png", "data": "iVBO"},
                {"mediaType": "image/tiff", "data": "AAAA"},
                {"mediaType": "image/png", "data": ""},
            ],
        })
        .as_object()
        .unwrap()
        .clone();
        let images = take(&mut arguments);
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].media_type, "image/png");
        assert!(!arguments.contains_key("images"));
        assert_eq!(arguments["instruction"], "Fix the sign-in hint");
    }

    #[test]
    fn keeps_an_image_under_its_identity_and_reads_it_back() {
        let directory = tempfile::tempdir().unwrap();
        let data = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAAfFcSJ".to_owned();
        let image = SentImage {
            media_type: "image/png".to_owned(),
            data: data.clone(),
        };
        keep(directory.path(), &[image.clone(), image]);
        let bytes =
            base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &data).unwrap();
        let id = identity(&bytes);
        assert_eq!(read(directory.path(), &id), Some(("image/png", data)));
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
        assert_eq!(read(directory.path(), &"0".repeat(64)), None);
        assert_eq!(read(directory.path(), "../../etc/passwd"), None);
    }
}
