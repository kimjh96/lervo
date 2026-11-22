//! The session host's ports to the Lervo core (ADR-0613, "The Lervo core does the work").
//!
//! The core prepares launches, runs application commands, and decodes provider streams. The
//! core-link adapter implements these ports over the resident Lervo process; `Disconnected`
//! answers every request with `application_unavailable`.

use std::future::Future;
use std::path::PathBuf;

use crate::status::SessionEvent;
use crate::transcript::Input;
use serde_json::{Map, Value};

/// How the user sees a session.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConversationMode {
    Native,
    Cli,
}

/// A provider process the core prepared for a session.
#[derive(Clone, Debug)]
pub struct Launch {
    pub session_id: String,
    pub workspace_id: String,
    pub mode: ConversationMode,
    /// The provider whose adapter decodes the native conversation.
    pub provider: String,
    pub program: String,
    pub arguments: Vec<String>,
    pub environment: Vec<(String, String)>,
    pub working_directory: PathBuf,
    /// Text to send through the stream decoder once the process runs, such as the instruction.
    pub initial_input: Option<String>,
}

/// What went wrong, in the session host's terms.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FailureCode {
    WorkspaceStartFailed,
    WorkspaceNotFound,
    LaunchIntentInvalid,
    ProviderCliUnavailable,
    ProviderLoginUnavailable,
    ConversationModeUnsupported,
    /// The resident process answered with a failure the session host has no name for.
    ApplicationFailed,
    /// The resident process is not running or not reachable.
    ApplicationUnavailable,
}

/// A failure that the session host reports with `request.failed`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Failure {
    pub code: FailureCode,
    /// The core's own code, kept for diagnosis.
    pub core_code: Option<String>,
    /// The failed stage of `workspace.start`.
    pub stage: Option<String>,
}

impl Failure {
    pub fn new(code: FailureCode) -> Self {
        Self {
            code,
            core_code: None,
            stage: None,
        }
    }

    /// The failure for a code the core reported.
    pub fn from_core(core_code: &str, stage: Option<String>) -> Self {
        let code = match core_code {
            "workspace_start_failed" => FailureCode::WorkspaceStartFailed,
            "workspace_not_found" => FailureCode::WorkspaceNotFound,
            "launch_intent_invalid" | "resume_unsupported" | "provider_unknown" => {
                FailureCode::LaunchIntentInvalid
            }
            "provider_cli_unavailable" => FailureCode::ProviderCliUnavailable,
            "provider_login_unavailable" => FailureCode::ProviderLoginUnavailable,
            "conversation_mode_unsupported" => FailureCode::ConversationModeUnsupported,
            _ => FailureCode::ApplicationFailed,
        };
        Self {
            code,
            core_code: Some(core_code.to_owned()),
            stage,
        }
    }
}

/// The result of an application command. A command that starts work also returns its launch.
#[derive(Clone, Debug, Default)]
pub struct CommandOutcome {
    pub result: Map<String, Value>,
    pub launch: Option<Launch>,
}

/// What a provider adapter decoded from a structured stream.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Decoded {
    /// The turn started, the agent asked the user, or the turn finished.
    Status(SessionEvent),
    /// A conversation item, or text for the streaming one.
    Conversation(Input),
}

/// Translates between the session host and one provider's structured stream. Provider formats
/// stay behind this port, so the session host never branches on a provider (invariant 2).
pub trait StreamDecoder: Send + 'static {
    /// Encodes the user's text for the provider's standard input, with what to show for it.
    fn send(&mut self, text: &str) -> impl Future<Output = (Vec<u8>, Vec<Decoded>)> + Send;

    /// Decodes a chunk of standard output. Chunks split anywhere, so the decoder keeps partial
    /// records until their end arrives.
    fn output(&mut self, bytes: &[u8]) -> impl Future<Output = Vec<Decoded>> + Send;
}

/// What the session host asks of the Lervo core.
pub trait Core: Send + Sync + 'static {
    /// The decoder for native sessions.
    type Decoder: StreamDecoder;

    /// The decoder for the provider of `launch`.
    fn decoder(&self, launch: &Launch) -> Self::Decoder;

    /// Prepares the agent session of an existing workspace (`session.open`), in `mode` when the
    /// interface asks for one and otherwise in the workspace's last mode.
    fn open(
        &self,
        workspace_id: &str,
        mode: Option<ConversationMode>,
    ) -> impl Future<Output = Result<Launch, Failure>> + Send;

    /// Runs an application command such as `workspace.start` (`application.command`).
    fn command(
        &self,
        command: &str,
        arguments: Map<String, Value>,
    ) -> impl Future<Output = Result<CommandOutcome, Failure>> + Send;
}

/// The core is not connected.
#[derive(Clone, Copy, Debug, Default)]
pub struct Disconnected;

impl Core for Disconnected {
    type Decoder = Disconnected;

    fn decoder(&self, _launch: &Launch) -> Self::Decoder {
        Self
    }

    async fn open(
        &self,
        _workspace_id: &str,
        _mode: Option<ConversationMode>,
    ) -> Result<Launch, Failure> {
        Err(Failure::new(FailureCode::ApplicationUnavailable))
    }

    async fn command(
        &self,
        _command: &str,
        _arguments: Map<String, Value>,
    ) -> Result<CommandOutcome, Failure> {
        Err(Failure::new(FailureCode::ApplicationUnavailable))
    }
}

impl StreamDecoder for Disconnected {
    async fn send(&mut self, _text: &str) -> (Vec<u8>, Vec<Decoded>) {
        (Vec::new(), Vec::new())
    }

    async fn output(&mut self, _bytes: &[u8]) -> Vec<Decoded> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::{Failure, FailureCode};

    #[test]
    fn names_the_core_codes_and_keeps_them() {
        let failure = Failure::from_core("workspace_start_failed", Some("workstream".to_owned()));
        assert_eq!(failure.code, FailureCode::WorkspaceStartFailed);
        assert_eq!(failure.stage.as_deref(), Some("workstream"));
        assert_eq!(
            Failure::from_core("resume_unsupported", None).code,
            FailureCode::LaunchIntentInvalid
        );
        let unknown = Failure::from_core("disk_full", None);
        assert_eq!(unknown.code, FailureCode::ApplicationFailed);
        assert_eq!(unknown.core_code.as_deref(), Some("disk_full"));
    }
}
