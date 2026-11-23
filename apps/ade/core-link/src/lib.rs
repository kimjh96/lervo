//! The core-link adapter (ADE convention, "Layers"). One external boundary: the resident Lervo
//! process, `lervo application serve --stdio`, which the session host starts as its child and
//! reaches over the core-link protocol.
//!
//! Requests that wait on the core time out, and a process that exits is started again on the next
//! request, so the session host keeps serving its sessions whatever the core does.

mod events;
mod failures;
mod link;

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use lervo_session_core::ports::{
    CommandOutcome, ConversationMode, Core, Decoded, Failure, FailureCode, Launch, StreamDecoder,
};
use lervo_session_core::transcript::{Content, Input};
use lervo_session_protocol::codec::CodecError;
use lervo_session_protocol::core_link::{CoreLinkCodec, CoreLinkResponse};
use serde_json::{Map, Value, json};

use link::Link;
pub use link::LinkError;

/// How long a command such as `workspace.start` may take.
const COMMAND_DEADLINE: Duration = Duration::from_secs(120);
/// How long decoding one chunk may take.
const DECODE_DEADLINE: Duration = Duration::from_secs(30);
/// Bytes of provider output in one `decoder.output` request.
const OUTPUT_CHUNK_BYTES: usize = 1024 * 1024;

/// The Lervo core through the resident process.
#[derive(Clone)]
pub struct CoreLink {
    link: Arc<Link>,
    next_decoder: Arc<AtomicU64>,
}

impl CoreLink {
    /// A core that runs `program` with `arguments`, normally `lervo application serve --stdio`.
    pub fn new(program: String, arguments: Vec<String>) -> Result<Self, CodecError> {
        Ok(Self {
            link: Arc::new(Link::new(program, arguments, CoreLinkCodec::new()?)),
            next_decoder: Arc::new(AtomicU64::new(1)),
        })
    }

    async fn ask(&self, request: Value, deadline: Duration) -> Result<CoreLinkResponse, Failure> {
        let Value::Object(request) = request else {
            return Err(Failure::new(FailureCode::ApplicationFailed));
        };
        self.link
            .request(request, deadline)
            .await
            .map_err(|error| failures::from_link(&error))
    }

    async fn launch(&self, request: Value) -> Result<CommandOutcome, Failure> {
        match self.ask(request, COMMAND_DEADLINE).await? {
            CoreLinkResponse::CoreResultResponse(response) => Ok(CommandOutcome {
                result: response.result,
                launch: response.launch.map(events::launch),
            }),
            CoreLinkResponse::CoreFailedResponse(response) => Err(failures::from_core(
                &response.code,
                response.stage.map(|stage| stage.to_string()),
            )),
            CoreLinkResponse::DecoderDecodedResponse(_) => {
                Err(Failure::new(FailureCode::ApplicationFailed))
            }
        }
    }
}

impl Core for CoreLink {
    type Decoder = LinkDecoder;

    fn decoder(&self, launch: &Launch) -> LinkDecoder {
        let number = self.next_decoder.fetch_add(1, Ordering::Relaxed);
        LinkDecoder {
            core: self.clone(),
            decoder_id: format!("dec_{number}"),
            provider: launch.provider.clone(),
            open: false,
        }
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

    async fn command(
        &self,
        command: &str,
        arguments: Map<String, Value>,
    ) -> Result<CommandOutcome, Failure> {
        self.launch(json!({"kind": "core.command", "command": command, "arguments": arguments}))
            .await
    }
}

/// One native session's decoder in the resident process. It opens there on first use and again
/// after the resident process restarted; a restart loses only a partial line.
pub struct LinkDecoder {
    core: CoreLink,
    decoder_id: String,
    provider: String,
    open: bool,
}

impl LinkDecoder {
    /// Sends `request` for this decoder, opening it first if needed and once more if the resident
    /// process no longer knows it.
    async fn decode(&mut self, request: Value) -> Result<(Vec<Decoded>, Option<String>), Failure> {
        for _ in 0..2 {
            if !self.open {
                let opened = json!({
                    "kind": "decoder.open",
                    "decoderId": self.decoder_id,
                    "provider": self.provider,
                });
                match self.core.ask(opened, DECODE_DEADLINE).await? {
                    CoreLinkResponse::DecoderDecodedResponse(_) => self.open = true,
                    CoreLinkResponse::CoreFailedResponse(response) => {
                        return Err(failures::from_core(&response.code, None));
                    }
                    CoreLinkResponse::CoreResultResponse(_) => {
                        return Err(Failure::new(FailureCode::ApplicationFailed));
                    }
                }
            }
            match self.core.ask(request.clone(), DECODE_DEADLINE).await? {
                CoreLinkResponse::DecoderDecodedResponse(response) => {
                    let decoded = response.events.into_iter().map(events::decoded).collect();
                    return Ok((decoded, response.input.map(|input| input.to_string())));
                }
                CoreLinkResponse::CoreFailedResponse(response)
                    if response.code.as_str() == "decoder_not_found" =>
                {
                    self.open = false;
                }
                CoreLinkResponse::CoreFailedResponse(response) => {
                    return Err(failures::from_core(&response.code, None));
                }
                CoreLinkResponse::CoreResultResponse(_) => {
                    return Err(Failure::new(FailureCode::ApplicationFailed));
                }
            }
        }
        Err(Failure::new(FailureCode::ApplicationUnavailable))
    }
}

/// The notice that replaces decoded events when the core cannot decode, so the user sees why.
fn unavailable(failure: &Failure) -> Decoded {
    let code = match failure.code {
        FailureCode::ApplicationUnavailable => "core_link_unavailable",
        _ => "core_decoding_failed",
    };
    Decoded::Conversation(Input::Item {
        content: Content::LervoNotice {
            code: code.to_owned(),
            parameters: Default::default(),
        },
        created_at_ms: now_ms(),
    })
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| {
            u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
        })
}

impl StreamDecoder for LinkDecoder {
    async fn send(&mut self, text: &str) -> (Vec<u8>, Vec<Decoded>) {
        let request = json!({"kind": "decoder.send", "decoderId": self.decoder_id, "text": text});
        match self.decode(request).await {
            Ok((decoded, Some(input))) => match STANDARD.decode(input) {
                Ok(bytes) => (bytes, decoded),
                Err(_) => (
                    Vec::new(),
                    vec![unavailable(&Failure::new(FailureCode::ApplicationFailed))],
                ),
            },
            Ok((decoded, None)) => (Vec::new(), decoded),
            Err(failure) => (Vec::new(), vec![unavailable(&failure)]),
        }
    }

    async fn output(&mut self, bytes: &[u8]) -> Vec<Decoded> {
        let mut all = Vec::new();
        for chunk in bytes.chunks(OUTPUT_CHUNK_BYTES) {
            let request = json!({
                "kind": "decoder.output",
                "decoderId": self.decoder_id,
                "data": STANDARD.encode(chunk),
            });
            match self.decode(request).await {
                Ok((decoded, _)) => all.extend(decoded),
                Err(failure) => {
                    all.push(unavailable(&failure));
                    break;
                }
            }
        }
        all
    }
}
