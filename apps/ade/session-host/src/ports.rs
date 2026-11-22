//! The session host's ports to the Lervo core (ADR-0613, "The Lervo core does the work").
//!
//! The core prepares launches, runs application commands, and decodes provider streams. S1.4
//! connects the resident Lervo process here; until then `Disconnected` answers every request with
//! `application_unavailable`.

use std::future::Future;
use std::path::PathBuf;

use lervo_session_core::status::SessionEvent;
use lervo_session_core::transcript::Input;
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
    pub program: String,
    pub arguments: Vec<String>,
    pub environment: Vec<(String, String)>,
    pub working_directory: PathBuf,
}

/// A failure that the session host reports with `request.failed`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FailureCode {
    WorkspaceStartFailed,
    ProviderCliUnavailable,
    ProviderLoginUnavailable,
    ApplicationUnavailable,
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

    /// Prepares the agent session of an existing workspace (`session.open`).
    fn open(&self, workspace_id: &str) -> impl Future<Output = Result<Launch, FailureCode>> + Send;

    /// Runs an application command such as `workspace.start` (`application.command`).
    fn command(
        &self,
        command: &str,
        arguments: Map<String, Value>,
    ) -> impl Future<Output = Result<CommandOutcome, FailureCode>> + Send;
}

/// The core is not connected.
#[derive(Clone, Copy, Debug, Default)]
pub struct Disconnected;

impl Core for Disconnected {
    type Decoder = Disconnected;

    fn decoder(&self, _launch: &Launch) -> Self::Decoder {
        Self
    }

    async fn open(&self, _workspace_id: &str) -> Result<Launch, FailureCode> {
        Err(FailureCode::ApplicationUnavailable)
    }

    async fn command(
        &self,
        _command: &str,
        _arguments: Map<String, Value>,
    ) -> Result<CommandOutcome, FailureCode> {
        Err(FailureCode::ApplicationUnavailable)
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
