//! The core-link adapter (ADE convention, "Layers"). One external boundary: the resident Lervo
//! process, `lervo application serve --stdio`, which the session host starts as its child and
//! reaches over the core-link protocol.
//!
//! Requests that wait on the core time out, and a process that exits is started again on the next
//! request, so the session host keeps serving its sessions whatever the core does.

mod decoder;
mod events;
mod failures;
mod link;
mod program;

use std::collections::BTreeSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use lervo_session_core::ports::{
    CommandOutcome, ConversationMode, Core, Failure, FailureCode, Launch, TranscriptPage,
};
use lervo_session_protocol::codec::CodecError;
use lervo_session_protocol::core_link::{CoreLinkCodec, CoreLinkResponse};
use serde_json::{Map, Value, json};

pub use decoder::LinkDecoder;
use link::Link;
pub use link::LinkError;

/// How long a command such as `workspace.start` may take.
const COMMAND_DEADLINE: Duration = Duration::from_secs(120);
/// How long decoding one chunk may take.
const DECODE_DEADLINE: Duration = Duration::from_secs(30);
/// Bytes of provider output in one `decoder.output` request.
const OUTPUT_CHUNK_BYTES: usize = 1024 * 1024;
/// Commands every resident process answers: those from before the core advertised its commands
/// (the contract's `baseApplicationCommandNames`). Any other command goes only to a process that
/// advertised it, because an older one ends the link on a request it cannot validate.
const BASE_COMMANDS: [&str; 3] = ["workspace.start", "workspace.list", "repository.list"];
/// The session host's exit report, a core-link request that a resident process advertises in
/// `workspace.list` beside its application commands.
const SESSION_EXITED: &str = "session.exited";
/// `decoder.open`'s `sessionId`, which a resident process advertises the same way. With it, the
/// process records the usage of the session's turns.
const DECODER_SESSION: &str = "decoder.session";
/// `decoder.interrupt`, which stops a native session's running turn. An older resident process
/// ends the link on a request it cannot validate, so only one that advertised it hears it.
const DECODER_INTERRUPT: &str = "decoder.interrupt";

/// The commands a resident process named in its last workspace list.
struct Advertised {
    generation: u64,
    commands: BTreeSet<String>,
}

/// The Lervo core through the resident process.
#[derive(Clone)]
pub struct CoreLink {
    link: Arc<Link>,
    next_decoder: Arc<AtomicU64>,
    advertised: Arc<Mutex<Option<Advertised>>>,
}

impl CoreLink {
    /// A core that runs `program` with `arguments`, normally `lervo application serve --stdio`.
    pub fn new(program: String, arguments: Vec<String>) -> Result<Self, CodecError> {
        Ok(Self {
            link: Arc::new(Link::new(program, arguments, CoreLinkCodec::new()?)),
            next_decoder: Arc::new(AtomicU64::new(1)),
            advertised: Arc::new(Mutex::new(None)),
        })
    }

    async fn ask(&self, request: Value, deadline: Duration) -> Result<CoreLinkResponse, Failure> {
        self.ask_on(request, deadline, None, false)
            .await
            .map(|(response, _)| response)
    }

    /// Sends `request`, only to the resident process of `generation` when one is given, and
    /// answers with the generation that answered. With `refresh`, an outdated process is replaced
    /// first; only base commands refresh, so a new process advertises its commands at once.
    async fn ask_on(
        &self,
        request: Value,
        deadline: Duration,
        generation: Option<u64>,
        refresh: bool,
    ) -> Result<(CoreLinkResponse, u64), Failure> {
        let Value::Object(request) = request else {
            return Err(Failure::new(FailureCode::ApplicationFailed));
        };
        self.link
            .request(request, deadline, generation, refresh)
            .await
            .map_err(|error| failures::from_link(&error))
    }

    async fn launch(&self, request: Value) -> Result<CommandOutcome, Failure> {
        self.launch_on(request, None, false)
            .await
            .map(|(outcome, _)| outcome)
    }

    async fn launch_on(
        &self,
        request: Value,
        generation: Option<u64>,
        refresh: bool,
    ) -> Result<(CommandOutcome, u64), Failure> {
        let (response, answered_by) = self
            .ask_on(request, COMMAND_DEADLINE, generation, refresh)
            .await?;
        match response {
            CoreLinkResponse::CoreResultResponse(response) => Ok((
                CommandOutcome {
                    result: response.result,
                    launch: response.launch.map(events::launch),
                },
                answered_by,
            )),
            CoreLinkResponse::CoreFailedResponse(response) => Err(failures::from_core(
                &response.code,
                response.stage.map(|stage| stage.to_string()),
            )),
            CoreLinkResponse::DecoderDecodedResponse(_)
            | CoreLinkResponse::TranscriptPageResponse(_) => {
                Err(Failure::new(FailureCode::ApplicationFailed))
            }
        }
    }
}

impl CoreLink {
    /// The generation of the resident process that advertised `command`, if any did.
    fn advertiser_of(&self, command: &str) -> Option<u64> {
        let advertised = self
            .advertised
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        advertised
            .as_ref()
            .filter(|advertised| advertised.commands.contains(command))
            .map(|advertised| advertised.generation)
    }

    /// The generation whose commands are recorded, if any.
    fn advertised_generation(&self) -> Option<u64> {
        self.advertised
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_ref()
            .map(|advertised| advertised.generation)
    }

    /// Asks the resident process of `generation` for its workspace list, only to record what it
    /// advertises. A failure leaves the record as it was; the interface's next list retries.
    async fn refresh_advertised(&self, generation: u64) {
        let request = json!({
            "kind": "core.command",
            "command": "workspace.list",
            "arguments": {},
        });
        let Ok((CoreLinkResponse::CoreResultResponse(response), answered_by)) = self
            .ask_on(request, COMMAND_DEADLINE, Some(generation), false)
            .await
        else {
            return;
        };
        if self
            .link
            .codec()
            .validate_result("workspace.list", &response.result)
            .is_ok()
        {
            self.record_advertised(answered_by, &response.result);
        }
    }

    /// Records the commands a workspace list named. An older core names none.
    fn record_advertised(&self, generation: u64, result: &Map<String, Value>) {
        let commands = result
            .get("commands")
            .and_then(Value::as_array)
            .map(|commands| {
                commands
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        *self
            .advertised
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some(Advertised {
            generation,
            commands,
        });
    }
}

impl Core for CoreLink {
    type Decoder = LinkDecoder;

    fn decoder(&self, launch: &Launch) -> LinkDecoder {
        let number = self.next_decoder.fetch_add(1, Ordering::Relaxed);
        LinkDecoder::new(
            self.clone(),
            format!("dec_{number}"),
            launch.provider.clone(),
            launch.session_id.clone(),
        )
    }

    async fn open(
        &self,
        workspace_id: &str,
        mode: Option<ConversationMode>,
    ) -> Result<Launch, Failure> {
        let mut request = json!({"kind": "core.open", "workspaceId": workspace_id});
        if let (Some(mode), Value::Object(object)) = (mode, &mut request) {
            object.insert("mode".to_owned(), Value::from(mode.code()));
        }
        let outcome = self.launch(request).await?;
        outcome
            .launch
            .ok_or_else(|| Failure::new(FailureCode::ApplicationFailed))
    }

    /// Sends a base command to any resident process and any other command only to the process
    /// that advertised it, and checks the result against the command's schema.
    async fn command(
        &self,
        command: &str,
        arguments: Map<String, Value>,
    ) -> Result<CommandOutcome, Failure> {
        let codec = self.link.codec();
        if !codec.knows_command(command) {
            return Err(failures::unsupported());
        }
        let generation = if BASE_COMMANDS.contains(&command) {
            None
        } else {
            Some(
                self.advertiser_of(command)
                    .ok_or_else(failures::unsupported)?,
            )
        };
        let request = json!({"kind": "core.command", "command": command, "arguments": arguments});
        let (outcome, answered_by) = self
            .launch_on(request, generation, generation.is_none())
            .await?;
        codec
            .validate_result(command, &outcome.result)
            .map_err(|_| failures::result_invalid())?;
        if command == "workspace.list" {
            self.record_advertised(answered_by, &outcome.result);
        } else if generation.is_none() && self.advertised_generation() != Some(answered_by) {
            // A base command started a new resident process, which has advertised nothing yet.
            // Ask it now, so a session this command launches names itself to that process at
            // once instead of after the interface's next workspace list.
            self.refresh_advertised(answered_by).await;
        }
        Ok(outcome)
    }

    /// Sends the report only to the resident process that advertised `session.exited`; an older
    /// one ends the link on a request it cannot validate. The answer only says what was recorded.
    async fn session_exited(&self, session_id: &str, exit_code: Option<u8>) {
        let Some(generation) = self.advertiser_of(SESSION_EXITED) else {
            return;
        };
        let request =
            json!({"kind": SESSION_EXITED, "sessionId": session_id, "exitCode": exit_code});
        let _ = self
            .ask_on(request, COMMAND_DEADLINE, Some(generation), false)
            .await;
    }

    async fn transcript(
        &self,
        workspace_id: &str,
        offset: u64,
        limit: u64,
    ) -> Result<TranscriptPage, Failure> {
        let request = json!({
            "kind": "transcript.read",
            "workspaceId": workspace_id,
            "offset": offset,
            "limit": limit,
        });
        match self.ask(request, COMMAND_DEADLINE).await? {
            CoreLinkResponse::TranscriptPageResponse(page) => Ok(TranscriptPage {
                items: page
                    .items
                    .into_iter()
                    .map(events::transcript_item)
                    .collect(),
                complete: page.complete,
            }),
            CoreLinkResponse::CoreFailedResponse(response) => {
                Err(failures::from_core(&response.code, None))
            }
            CoreLinkResponse::CoreResultResponse(_)
            | CoreLinkResponse::DecoderDecodedResponse(_) => {
                Err(Failure::new(FailureCode::ApplicationFailed))
            }
        }
    }
}
