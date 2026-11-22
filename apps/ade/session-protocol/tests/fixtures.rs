//! Contract tests: the Rust side accepts and rejects the same fixtures as the TypeScript side.

// A failing fixture read should stop the test at once, so this test file may unwrap.
#![allow(clippy::unwrap_used)]

use std::fs;
use std::path::PathBuf;

use lervo_session_protocol::codec::{CodecError, MessageCodec, encode};
use serde_json::Value;

fn fixtures(directory: &str) -> Vec<(String, Value)> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/session-host-contract/test/fixtures")
        .join(directory);
    let mut entries: Vec<_> = fs::read_dir(&root)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "json")
        })
        .collect();
    entries.sort();
    assert!(!entries.is_empty(), "no fixtures in {}", root.display());
    entries
        .into_iter()
        .map(|path| {
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            let value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
            (name, value)
        })
        .collect()
}

#[test]
fn accepts_and_round_trips_every_client_fixture() {
    let codec = MessageCodec::new().unwrap();
    for (name, value) in fixtures("client") {
        let message = codec
            .decode_client(&encode(&value).unwrap())
            .unwrap_or_else(|error| panic!("{name}: {error}"));
        assert_eq!(serde_json::to_value(&message).unwrap(), value, "{name}");
        let again = codec.decode_client(&encode(&message).unwrap()).unwrap();
        assert_eq!(serde_json::to_value(&again).unwrap(), value, "{name}");
        assert!(
            codec.decode_host(&encode(&value).unwrap()).is_err(),
            "{name}"
        );
    }
}

#[test]
fn accepts_and_round_trips_every_host_fixture() {
    let codec = MessageCodec::new().unwrap();
    for (name, value) in fixtures("host") {
        let message = codec
            .decode_host(&encode(&value).unwrap())
            .unwrap_or_else(|error| panic!("{name}: {error}"));
        assert_eq!(serde_json::to_value(&message).unwrap(), value, "{name}");
        assert!(
            codec.decode_client(&encode(&value).unwrap()).is_err(),
            "{name}"
        );
    }
}

#[test]
fn rejects_every_invalid_fixture_without_echoing_its_values() {
    let codec = MessageCodec::new().unwrap();
    for (name, value) in fixtures("invalid") {
        let payload = encode(&value).unwrap();
        for error in [
            codec.decode_client(&payload).err(),
            codec.decode_host(&payload).err(),
        ] {
            let error = error.unwrap_or_else(|| panic!("{name} was accepted"));
            assert!(
                matches!(error, CodecError::Invalid { .. }),
                "{name}: {error}"
            );
            assert!(
                !error.to_string().contains("Knowledge lint passed"),
                "{name}"
            );
        }
    }
}

#[test]
fn rejects_bytes_that_are_not_messagepack() {
    let codec = MessageCodec::new().unwrap();
    assert!(matches!(
        codec.decode_client(&[0xc1]),
        Err(CodecError::Undecodable)
    ));
}
