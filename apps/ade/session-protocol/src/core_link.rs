//! The core link between the session host and the resident Lervo process (core-link protocol):
//! one JSON message per line over the resident process's standard streams.
//!
//! Responses are validated against the same document the TypeScript side validates requests
//! with, before they become typed values. Errors name the location and the rule, never the value.

use std::collections::BTreeMap;

use serde_json::{Map, Value};

use crate::codec::CodecError;

#[allow(clippy::all, clippy::unwrap_used, clippy::expect_used, missing_docs)]
mod generated {
    include!(concat!(env!("OUT_DIR"), "/core_link.rs"));
}

pub use generated::*;

const CORE_LINK_DOCUMENT: &str = include_str!(
    "../../../../packages/session-host-contract/generated/core-link-protocol.schema.json"
);

/// Validates responses from the resident process, and the results of application commands.
pub struct CoreLinkCodec {
    response: jsonschema::Validator,
    /// Each application command's result validator, by command name.
    results: BTreeMap<String, jsonschema::Validator>,
}

impl CoreLinkCodec {
    /// Compiles the response validator from the embedded document.
    pub fn new() -> Result<Self, CodecError> {
        let document: Value =
            serde_json::from_str(CORE_LINK_DOCUMENT).map_err(|_| CodecError::Document)?;
        let response = validator(&document, "#/$defs/CoreLinkResponse")?;
        let commands = document
            .pointer("/$defs/CoreCommandRequest/properties/command/enum")
            .and_then(Value::as_array)
            .ok_or(CodecError::Document)?;
        let results = commands
            .iter()
            .filter_map(Value::as_str)
            .map(|command| {
                let reference = format!("#/$defs/{}", result_title(command));
                Ok((command.to_owned(), validator(&document, &reference)?))
            })
            .collect::<Result<_, CodecError>>()?;
        Ok(Self { response, results })
    }

    /// Whether the contract defines `command`, an application command.
    pub fn knows_command(&self, command: &str) -> bool {
        self.results.contains_key(command)
    }

    /// Checks an application command's result against the command's schema.
    pub fn validate_result(
        &self,
        command: &str,
        result: &Map<String, Value>,
    ) -> Result<(), CodecError> {
        let Some(validator) = self.results.get(command) else {
            return Err(CodecError::Document);
        };
        let value = Value::Object(result.clone());
        match validator.iter_errors(&value).next() {
            Some(error) => Err(CodecError::Invalid {
                path: error.instance_path().to_string(),
                rule: error.schema_path().to_string(),
            }),
            None => Ok(()),
        }
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

/// A validator for the definition at `reference` within the core-link document.
fn validator(document: &Value, reference: &str) -> Result<jsonschema::Validator, CodecError> {
    let mut root = document.clone();
    let Value::Object(object) = &mut root else {
        return Err(CodecError::Document);
    };
    object.remove("oneOf");
    object.insert("$ref".to_owned(), Value::String(reference.to_owned()));
    jsonschema::validator_for(&root).map_err(|_| CodecError::Document)
}

/// The title of a command's result schema: `provider.list` has `ProviderListResult`. The
/// contract's tests hold every result schema to this name.
fn result_title(command: &str) -> String {
    let mut title: String = command
        .split(['.', '_'])
        .map(|part| {
            let mut letters = part.chars();
            letters.next().map_or_else(String::new, |first| {
                first.to_uppercase().chain(letters).collect::<String>()
            })
        })
        .collect();
    title.push_str("Result");
    title
}

#[cfg(test)]
mod tests {
    use super::{CoreLinkCodec, result_title};

    #[test]
    fn names_each_command_result_and_finds_it_in_the_document() {
        assert_eq!(result_title("provider.list"), "ProviderListResult");
        assert_eq!(result_title("workspace.start"), "WorkspaceStartResult");
        let codec = CoreLinkCodec::new();
        assert_eq!(result_title("workspace.retire"), "WorkspaceRetireResult");
        let codec = codec.expect("the contract document compiles");
        assert!(codec.knows_command("provider.list"));
        assert!(codec.knows_command("workspace.retire"));
    }
}
