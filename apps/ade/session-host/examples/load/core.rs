//! The stand-in core: launches for each scenario and a decoder that streams provider lines.

use lervo_session_core::ports::{
    CommandOutcome, ConversationMode, Core, Decoded, Failure, FailureCode, Launch, StreamDecoder,
};
use lervo_session_core::status::SessionEvent;
use lervo_session_core::transcript::{Content, Input};
use serde_json::{Map, Value};

pub struct LoadCore;

/// Turns each line of the streaming provider into a delta of one streaming agent message.
#[derive(Default)]
pub struct LineDecoder {
    partial: Vec<u8>,
    started: bool,
}

impl StreamDecoder for LineDecoder {
    async fn send(&mut self, text: &str) -> (Vec<u8>, Vec<Decoded>) {
        (format!("{text}\n").into_bytes(), Vec::new())
    }

    async fn output(&mut self, bytes: &[u8]) -> Vec<Decoded> {
        self.partial.extend_from_slice(bytes);
        let mut decoded = Vec::new();
        if !self.started {
            self.started = true;
            decoded.push(Decoded::Status(SessionEvent::TurnStarted));
            decoded.push(Decoded::Conversation(Input::Start {
                content: Content::AgentMessage(String::new()),
                created_at_ms: 0,
            }));
        }
        while let Some(end) = self.partial.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = self.partial.drain(..=end).collect();
            decoded.push(Decoded::Conversation(Input::Delta(
                String::from_utf8_lossy(&line).into_owned(),
            )));
        }
        decoded
    }
}

impl Core for LoadCore {
    type Decoder = LineDecoder;

    fn decoder(&self, _launch: &Launch) -> LineDecoder {
        LineDecoder::default()
    }

    async fn open(
        &self,
        workspace_id: &str,
        _mode: Option<ConversationMode>,
    ) -> Result<Launch, Failure> {
        let me =
            std::env::current_exe().map_err(|_| Failure::new(FailureCode::ApplicationFailed))?;
        let (mode, program, arguments) = match workspace_id {
            "wks_stream" => (
                ConversationMode::Native,
                me.display().to_string(),
                vec!["emit".to_owned()],
            ),
            "wks_flood" => (
                ConversationMode::Cli,
                "/bin/sh".to_owned(),
                vec![
                    "-c".to_owned(),
                    "while :; do yes 0123456789abcdefghijklmnopqrstuvwxyz | head -c 100000; sleep 0.05; done & exec cat"
                        .to_owned(),
                ],
            ),
            _ => (ConversationMode::Cli, "/bin/cat".to_owned(), Vec::new()),
        };
        Ok(Launch {
            session_id: format!("ses_{}", workspace_id.trim_start_matches("wks_")),
            workspace_id: workspace_id.to_owned(),
            mode,
            program,
            arguments,
            environment: Vec::new(),
            working_directory: std::env::temp_dir(),
            provider: "load".to_owned(),
            initial_input: None,
            environment_remove: Vec::new(),
            transcript: false,
        })
    }

    async fn command(
        &self,
        _command: &str,
        _arguments: Map<String, Value>,
    ) -> Result<CommandOutcome, Failure> {
        Err(Failure::new(FailureCode::ApplicationUnavailable))
    }
}
