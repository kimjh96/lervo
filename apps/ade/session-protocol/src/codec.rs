//! Control messages: MessagePack encoding and validation against the protocol schema.
//!
//! Every decoded message is validated against the same JSON Schema document the TypeScript side
//! uses before it becomes a typed value. Errors name the location and the rule that failed, never
//! the value, so conversation text stays out of logs.

use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::{ClientMessage, HostMessage};

const PROTOCOL_DOCUMENT: &str = include_str!(
    "../../../../packages/session-host-contract/generated/session-host-protocol.schema.json"
);

/// Why a control message could not be encoded or decoded.
#[derive(Debug, thiserror::Error)]
pub enum CodecError {
    /// The payload is not MessagePack.
    #[error("message_undecodable")]
    Undecodable,
    /// The message breaks the protocol schema at `path`.
    #[error("message_invalid at {path}: {rule}")]
    Invalid { path: String, rule: String },
    /// The message could not be serialized.
    #[error("message_unencodable")]
    Unencodable,
    /// The embedded protocol document could not be compiled.
    #[error("protocol_document_invalid")]
    Document,
}

/// Validating decoder for both directions of the protocol.
pub struct MessageCodec {
    client: jsonschema::Validator,
    host: jsonschema::Validator,
}

impl MessageCodec {
    /// Compiles the validators from the embedded protocol document.
    pub fn new() -> Result<Self, CodecError> {
        let document: Value =
            serde_json::from_str(PROTOCOL_DOCUMENT).map_err(|_| CodecError::Document)?;
        Ok(Self {
            client: validator_for(&document, "ClientMessage")?,
            host: validator_for(&document, "HostMessage")?,
        })
    }

    /// Decodes and validates a message from the interface.
    pub fn decode_client(&self, payload: &[u8]) -> Result<ClientMessage, CodecError> {
        decode(&self.client, payload)
    }

    /// Decodes and validates a message from the session host.
    pub fn decode_host(&self, payload: &[u8]) -> Result<HostMessage, CodecError> {
        decode(&self.host, payload)
    }
}

/// Encodes a message as MessagePack with named fields, matching the schema's property names.
pub fn encode<T: Serialize>(message: &T) -> Result<Vec<u8>, CodecError> {
    rmp_serde::to_vec_named(message).map_err(|_| CodecError::Unencodable)
}

/// Decodes a record this side encoded earlier, such as a stored conversation item. Records come
/// from owner-only files, not from the peer, so they are not validated against the schema.
pub fn decode_record<T: serde::de::DeserializeOwned>(record: &[u8]) -> Result<T, CodecError> {
    rmp_serde::from_slice(record).map_err(|_| CodecError::Undecodable)
}

fn validator_for(document: &Value, definition: &str) -> Result<jsonschema::Validator, CodecError> {
    let mut root = document.clone();
    let Value::Object(object) = &mut root else {
        return Err(CodecError::Document);
    };
    object.remove("oneOf");
    object.insert(
        "$ref".to_owned(),
        Value::String(format!("#/$defs/{definition}")),
    );
    jsonschema::validator_for(&root).map_err(|_| CodecError::Document)
}

fn decode<T: DeserializeOwned>(
    validator: &jsonschema::Validator,
    payload: &[u8],
) -> Result<T, CodecError> {
    let value: Value = rmp_serde::from_slice(payload).map_err(|_| CodecError::Undecodable)?;
    if let Some(error) = validator.iter_errors(&value).next() {
        return Err(CodecError::Invalid {
            path: error.instance_path().to_string(),
            rule: error.schema_path().to_string(),
        });
    }
    serde_json::from_value(value).map_err(|_| CodecError::Invalid {
        path: String::new(),
        rule: "typed decoding".to_owned(),
    })
}
