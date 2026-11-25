//! A native session's stream decoder in the resident process (ADE core link, "Failure meaning").

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use lervo_session_core::ports::{Decoded, Failure, FailureCode, StreamDecoder};
use lervo_session_core::status::SessionEvent;
use lervo_session_core::transcript::{Content, Input};
use lervo_session_protocol::core_link::CoreLinkResponse;
use serde_json::{Value, json};

use crate::{
    CoreLink, DECODE_DEADLINE, DECODER_INTERRUPT, DECODER_SESSION, OUTPUT_CHUNK_BYTES, events,
    failures,
};

/// One native session's decoder in the resident process. It opens there on first use and again
/// after the resident process restarted; a restart loses only a partial line.
pub struct LinkDecoder {
    core: CoreLink,
    decoder_id: String,
    provider: String,
    /// The hosted session the decoder serves, named to a resident process that records usage.
    session_id: String,
    open: bool,
    /// Whether the open decoder heard the session's ID. One opened before its resident process
    /// advertised `decoder.session` opens again, named, before the next turn.
    named: bool,
    /// Between a turn's start and its finish, as the decoded status events say.
    in_turn: bool,
    /// The last output ended inside a line, which the resident process holds until the rest.
    mid_line: bool,
    /// Whether this decoder keeps the resident process from being replaced.
    holding: bool,
}

impl Drop for LinkDecoder {
    fn drop(&mut self) {
        if self.holding {
            self.core.link.release();
        }
    }
}

impl LinkDecoder {
    pub(crate) fn new(
        core: CoreLink,
        decoder_id: String,
        provider: String,
        session_id: String,
    ) -> Self {
        Self {
            core,
            decoder_id,
            provider,
            session_id,
            open: false,
            named: false,
            in_turn: false,
            mid_line: false,
            holding: false,
        }
    }

    /// Follows the turn and the line through `decoded`, and holds the resident process while
    /// either is open, because a replaced process would start this decoder over.
    fn track(&mut self, decoded: &[Decoded], mid_line: Option<bool>) {
        for event in decoded {
            match event {
                Decoded::Status(SessionEvent::TurnStarted) => self.in_turn = true,
                Decoded::Status(SessionEvent::TurnFinished) => self.in_turn = false,
                _ => {}
            }
        }
        if let Some(mid_line) = mid_line {
            self.mid_line = mid_line;
        }
        let holding = self.in_turn || self.mid_line;
        if holding != self.holding {
            self.holding = holding;
            if holding {
                self.core.link.hold();
            } else {
                self.core.link.release();
            }
        }
    }

    /// Opens the decoder in the resident process. Only a process that advertised
    /// `decoder.session` hears the session's ID, because an older one ends the link on a field it
    /// cannot validate; when that process was replaced meanwhile, the decoder opens without it
    /// and the new process records no usage for it.
    async fn open_decoder(&self) -> Result<(CoreLinkResponse, bool), Failure> {
        let opened = json!({
            "kind": "decoder.open",
            "decoderId": self.decoder_id,
            "provider": self.provider,
        });
        if let Some(generation) = self.core.advertiser_of(DECODER_SESSION) {
            let mut named = opened.clone();
            named["sessionId"] = Value::from(self.session_id.as_str());
            if let Ok((response, _)) = self
                .core
                .ask_on(named, DECODE_DEADLINE, Some(generation), false)
                .await
            {
                return Ok((response, true));
            }
        }
        Ok((self.core.ask(opened, DECODE_DEADLINE).await?, false))
    }

    /// Sends `request` for this decoder, opening it first if needed and once more if the resident
    /// process no longer knows it.
    async fn decode(&mut self, request: Value) -> Result<(Vec<Decoded>, Option<String>), Failure> {
        for _ in 0..2 {
            if !self.open {
                let (response, named) = self.open_decoder().await?;
                match response {
                    CoreLinkResponse::DecoderDecodedResponse(_) => {
                        self.open = true;
                        self.named = named;
                    }
                    CoreLinkResponse::CoreFailedResponse(response) => {
                        return Err(failures::from_core(&response.code, None));
                    }
                    CoreLinkResponse::CoreResultResponse(_)
                    | CoreLinkResponse::TranscriptPageResponse(_) => {
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
                CoreLinkResponse::CoreResultResponse(_)
                | CoreLinkResponse::TranscriptPageResponse(_) => {
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
        // Between turns the decoder holds no partial state, so one opened before its process
        // advertised `decoder.session` opens again, named, and this turn's usage is recorded.
        if self.open
            && !self.named
            && !self.in_turn
            && !self.mid_line
            && self.core.advertiser_of(DECODER_SESSION).is_some()
        {
            self.open = false;
        }
        let request = json!({"kind": "decoder.send", "decoderId": self.decoder_id, "text": text});
        let answer = self.decode(request).await;
        if let Ok((decoded, _)) = &answer {
            self.track(decoded, None);
        }
        match answer {
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

    /// Asks the resident process that advertised `decoder.interrupt` for the bytes that stop
    /// the turn. A decoder never opened has run no turn, so there is nothing to stop. During a
    /// turn this decoder holds its process, so the advertiser is the process that knows it.
    async fn interrupt(&mut self) -> Result<(Vec<u8>, Vec<Decoded>), Failure> {
        let Some(generation) = self.core.advertiser_of(DECODER_INTERRUPT) else {
            return Err(Failure::new(FailureCode::InterruptUnsupported));
        };
        if !self.open || !self.in_turn {
            return Ok((Vec::new(), Vec::new()));
        }
        let request = json!({"kind": "decoder.interrupt", "decoderId": self.decoder_id});
        let (response, _) = self
            .core
            .ask_on(request, DECODE_DEADLINE, Some(generation), false)
            .await?;
        match response {
            CoreLinkResponse::DecoderDecodedResponse(response) => {
                let decoded: Vec<Decoded> =
                    response.events.into_iter().map(events::decoded).collect();
                self.track(&decoded, None);
                let bytes = match response.input {
                    Some(input) => STANDARD
                        .decode(input.to_string())
                        .map_err(|_| Failure::new(FailureCode::ApplicationFailed))?,
                    None => Vec::new(),
                };
                Ok((bytes, decoded))
            }
            CoreLinkResponse::CoreFailedResponse(response) => {
                Err(failures::from_core(&response.code, None))
            }
            CoreLinkResponse::CoreResultResponse(_)
            | CoreLinkResponse::TranscriptPageResponse(_) => {
                Err(Failure::new(FailureCode::ApplicationFailed))
            }
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
                Ok((decoded, _)) => {
                    self.track(&decoded, Some(!chunk.ends_with(b"\n")));
                    all.extend(decoded);
                }
                Err(failure) => {
                    all.push(unavailable(&failure));
                    break;
                }
            }
        }
        all
    }
}
