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

impl ConversationMode {
    /// The mode's name across Lervo: the core's launch descriptors use it.
    pub fn code(self) -> &'static str {
        match self {
            Self::Native => "native",
            Self::Cli => "cli",
        }
    }
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
    /// Images sent with the initial input, such as those pasted with the instruction. The session
    /// host takes them from `workspace.start`'s arguments; the core never sees them.
    pub initial_images: Vec<SentImage>,
    /// Variables of the session host's own environment the process must not inherit, such as an
    /// enclosing agent session's markers.
    pub environment_remove: Vec<String>,
    /// Whether the core can read this session's provider transcript (`Core::transcript`).
    pub transcript: bool,
}

/// A page of a provider's own transcript: complete items, oldest first.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TranscriptPage {
    /// Each a complete `Input::Item`.
    pub items: Vec<Input>,
    /// Whether the transcript ended with this page.
    pub complete: bool,
}

impl TranscriptPage {
    /// The page of a transcript that holds nothing.
    pub fn empty() -> Self {
        Self {
            items: Vec::new(),
            complete: true,
        }
    }
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
    /// The resident process did not answer in time.
    ApplicationTimeout,
    /// The provider or the running core cannot stop a turn and keep the session.
    InterruptUnsupported,
    /// The provider or the running core cannot carry images in a message.
    ImagesUnsupported,
}

/// A failure that the session host reports with `request.failed`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Failure {
    pub code: FailureCode,
    /// The core's own code, kept for diagnosis.
    pub core_code: Option<String>,
    /// The failed stage of `workspace.start`.
    pub stage: Option<String>,
    /// Why the session host itself refused or rejected the request, such as
    /// `command_unsupported` or `result_invalid`.
    pub reason: Option<&'static str>,
}

impl Failure {
    pub fn new(code: FailureCode) -> Self {
        Self {
            code,
            core_code: None,
            stage: None,
            reason: None,
        }
    }

    /// The same failure, with the session host's reason for it.
    #[must_use]
    pub fn because(mut self, reason: &'static str) -> Self {
        self.reason = Some(reason);
        self
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
    /// A turn for another agent of the conversation, which the session host gives it.
    Delivery(RoomDelivery),
}

/// A turn for another agent of the conversation (Lervo ADE rooms, "The core link and the session
/// host"). The session host gives it to the agent's session, joining the agent first through
/// `room.join` when it has none, and after the session's running turn.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoomDelivery {
    pub delivery_id: String,
    pub workspace_id: String,
    pub agent_id: String,
    /// The agent's session in the conversation; none when the agent joins with this turn.
    pub session_id: Option<String>,
    /// The session whose turn set the delivery off, which shows a delivery that failed.
    pub source_session_id: Option<String>,
    pub text: String,
}

/// An image the user sent with a message: its media type and its bytes as Base64, as the
/// protocol checked them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SentImage {
    pub media_type: String,
    pub data: String,
}

/// Translates between the session host and one provider's structured stream. Provider formats
/// stay behind this port, so the session host never branches on a provider (invariant 2).
pub trait StreamDecoder: Send + 'static {
    /// Encodes the user's text for the provider's standard input, with what to show for it.
    fn send(&mut self, text: &str) -> impl Future<Output = (Vec<u8>, Vec<Decoded>)> + Send;

    /// Encodes a delivered turn, so the core shows it as its sender's message rather than the
    /// user's. A decoder whose core does not route deliveries sends it as the user's text.
    fn send_delivery(
        &mut self,
        text: &str,
        _delivery_id: &str,
    ) -> impl Future<Output = (Vec<u8>, Vec<Decoded>)> + Send {
        self.send(text)
    }

    /// Decodes a chunk of standard output. Chunks split anywhere, so the decoder keeps partial
    /// records until their end arrives.
    fn output(&mut self, bytes: &[u8]) -> impl Future<Output = Vec<Decoded>> + Send;

    /// Encodes the user's text and images for the provider's standard input, with what to show
    /// for them. A decoder that cannot carry images fails with `ImagesUnsupported`.
    fn send_with_images(
        &mut self,
        _text: &str,
        _images: &[SentImage],
    ) -> impl Future<Output = Result<(Vec<u8>, Vec<Decoded>), Failure>> + Send {
        std::future::ready(Err(Failure::new(FailureCode::ImagesUnsupported)))
    }

    /// Encodes the request that stops the provider's running turn and keeps its session, with
    /// what to show for it. The bytes are empty when no turn is running. A decoder that cannot
    /// stop a turn fails with `InterruptUnsupported`.
    fn interrupt(
        &mut self,
    ) -> impl Future<Output = Result<(Vec<u8>, Vec<Decoded>), Failure>> + Send {
        std::future::ready(Err(Failure::new(FailureCode::InterruptUnsupported)))
    }
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

    /// A page of the provider's own transcript of the workspace's session, for a launch the core
    /// marked `transcript`. A core that reads no transcripts answers an empty, complete page.
    fn transcript(
        &self,
        _workspace_id: &str,
        _offset: u64,
        _limit: u64,
    ) -> impl Future<Output = Result<TranscriptPage, Failure>> + Send {
        async { Ok(TranscriptPage::empty()) }
    }

    /// Reports that a hosted session's process ended (`session.exited`), with its exit code or
    /// none after a signal, so the core can record an end the provider's own hook did not. A core
    /// that does not take the report ignores it.
    fn session_exited(
        &self,
        _session_id: &str,
        _exit_code: Option<u8>,
    ) -> impl Future<Output = ()> + Send {
        async {}
    }
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
