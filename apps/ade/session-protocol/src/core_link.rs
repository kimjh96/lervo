//! The core link between the session host and the resident Lervo process (core-link protocol):
//! one JSON message per line over the resident process's standard streams.
//!
//! Responses are validated against the same document the TypeScript side validates requests
//! with, before they become typed values. Errors name the location and the rule, never the value.

use serde_json::Value;

use crate::codec::CodecError;

#[allow(clippy::all, clippy::unwrap_used, clippy::expect_used, missing_docs)]
mod generated {
    include!(concat!(env!("OUT_DIR"), "/core_link.rs"));
}

pub use generated::*;

const CORE_LINK_DOCUMENT: &str = include_str!(
    "../../../../packages/session-host-contract/generated/core-link-protocol.schema.json"
);

/// Validates responses from the resident process.
pub struct CoreLinkCodec {
    response: jsonschema::Validator,
}

impl CoreLinkCodec {
    /// Compiles the response validator from the embedded document.
    pub fn new() -> Result<Self, CodecError> {
        let mut document: Value =
            serde_json::from_str(CORE_LINK_DOCUMENT).map_err(|_| CodecError::Document)?;
        let Value::Object(object) = &mut document else {
            return Err(CodecError::Document);
        };
        object.remove("oneOf");
        object.insert(
            "$ref".to_owned(),
            Value::String("#/$defs/CoreLinkResponse".to_owned()),
        );
        let response = jsonschema::validator_for(&document).map_err(|_| CodecError::Document)?;
        Ok(Self { response })
    }

    /// One response line, validated, as a typed value.
    pub fn decode_response(&self, line: &str) -> Result<CoreLinkResponse, CodecError> {
        let value: Value = serde_json::from_str(line).map_err(|_| CodecError::Undecodable)?;
        if let Some(error) = self.response.iter_errors(&value).next() {
            return Err(CodecError::Invalid {
                path: error.instance_path().to_string(),
                rule: error.schema_path().to_string(),
            });
        }
        serde_json::from_value(value).map_err(|_| CodecError::Undecodable)
    }
}
