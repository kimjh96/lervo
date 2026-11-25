//! The scripted core: four workspaces, their launches, and a decoder for the scripted providers.

use std::collections::HashMap;
use std::collections::VecDeque;
use std::io::{BufRead, Write};
use std::process::ExitCode;
use std::sync::Mutex;
use std::sync::mpsc::RecvTimeoutError;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use lervo_session_core::ports::{
    CommandOutcome, ConversationMode, Core, Decoded, Failure, FailureCode, Launch, StreamDecoder,
};
use lervo_session_core::status::SessionEvent;
use lervo_session_core::transcript::{Content, Input};
use serde_json::{Map, Value, json};

/// The session whose index holds the seeded conversation.
pub const HISTORY_SESSION: &str = "ses_history";
/// Deltas the streaming provider writes after each reply, one every `STREAM_INTERVAL`.
const STREAM_DELTAS: u32 = 1_000;
const STREAM_INTERVAL: Duration = Duration::from_millis(2);
/// The line that ends a scripted provider's turn.
const TURN_END: &str = "\u{1e}end";
/// The line the scripted decoder writes to stop a turn.
const STOP_LINE: &str = "\u{1e}stop";
/// A reply that starts with this word streams slowly until it is stopped, for checking Stop.
const SLOW_REPLY: &str = "slow";
/// Lines a slow reply writes at most, one every `SLOW_INTERVAL`.
const SLOW_LINES: u32 = 600;
const SLOW_INTERVAL: Duration = Duration::from_millis(150);

struct Workspace {
    id: &'static str,
    session: &'static str,
    repository: &'static str,
    project: &'static str,
    branch: &'static str,
    title: &'static str,
    mode: ConversationMode,
}

const WORKSPACES: [Workspace; 4] = [
    Workspace {
        id: "wks_history",
        session: HISTORY_SESSION,
        repository: "lervo",
        project: "prj_interface_lervo",
        branch: "desktop-design",
        title: "Design the desktop app",
        mode: ConversationMode::Native,
    },
    Workspace {
        id: "wks_stream",
        session: "ses_stream",
        repository: "lervo",
        project: "prj_interface_lervo",
        branch: "stream-replies",
        title: "Stream a long reply",
        mode: ConversationMode::Native,
    },
    Workspace {
        id: "wks_echo",
        session: "ses_echo",
        repository: "lervo",
        project: "prj_interface_lervo",
        branch: "terminal-echo",
        title: "Echo in the terminal",
        mode: ConversationMode::Cli,
    },
    Workspace {
        id: "wks_deploy",
        session: "ses_deploy",
        repository: "shiflo",
        project: "prj_interface_shiflo",
        branch: "deploy-checks",
        title: "Tidy the deploy checks",
        mode: ConversationMode::Native,
    },
];

/// The scripted core. Like the Lervo core, it remembers the mode each workspace last opened in,
/// and `workspace.list` reports it, so the interface's mode switch round-trips.
#[derive(Default)]
pub struct InterfaceCore {
    modes: Mutex<HashMap<&'static str, ConversationMode>>,
}

impl InterfaceCore {
    fn mode(&self, workspace: &Workspace) -> ConversationMode {
        self.modes
            .lock()
            .ok()
            .and_then(|modes| modes.get(workspace.id).copied())
            .unwrap_or(workspace.mode)
    }
}

impl Core for InterfaceCore {
    type Decoder = ScriptDecoder;

    fn decoder(&self, _launch: &Launch) -> ScriptDecoder {
        ScriptDecoder::default()
    }

    async fn open(
        &self,
        workspace_id: &str,
        mode: Option<ConversationMode>,
    ) -> Result<Launch, Failure> {
        let workspace = WORKSPACES
            .iter()
            .find(|workspace| workspace.id == workspace_id)
            .ok_or(Failure::new(FailureCode::WorkspaceNotFound))?;
        let mode = match mode {
            Some(mode) => {
                if let Ok(mut modes) = self.modes.lock() {
                    modes.insert(workspace.id, mode);
                }
                mode
            }
            None => self.mode(workspace),
        };
        let (program, arguments) = match (workspace.id, mode) {
            (_, ConversationMode::Cli) => ("/bin/cat".to_owned(), Vec::new()),
            ("wks_stream", ConversationMode::Native) => (
                std::env::current_exe()
                    .map_err(|_| Failure::new(FailureCode::ApplicationFailed))?
                    .display()
                    .to_string(),
                vec!["emit".to_owned()],
            ),
            // Other native providers answer each reply with the reply itself.
            _ => (
                std::env::current_exe()
                    .map_err(|_| Failure::new(FailureCode::ApplicationFailed))?
                    .display()
                    .to_string(),
                vec!["echo".to_owned()],
            ),
        };
        Ok(Launch {
            session_id: workspace.session.to_owned(),
            workspace_id: workspace.id.to_owned(),
            mode,
            program,
            arguments,
            environment: Vec::new(),
            working_directory: std::env::temp_dir(),
            provider: "claude".to_owned(),
            initial_input: None,
            initial_images: Vec::new(),
            environment_remove: Vec::new(),
            transcript: false,
        })
    }

    async fn command(
        &self,
        command: &str,
        _arguments: Map<String, Value>,
    ) -> Result<CommandOutcome, Failure> {
        let result = match command {
            "workspace.list" => {
                let workspaces: Vec<Value> = WORKSPACES
                    .iter()
                    .map(|workspace| listed(workspace, self.mode(workspace)))
                    .collect();
                // Like a current core, it advertises stopping a turn.
                json!({
                    "workspaces": workspaces,
                    "commands": ["workspace.start", "workspace.list", "repository.list", "decoder.interrupt"],
                })
            }
            "repository.list" => json!({ "repositories": [
                { "projectId": "prj_interface_lervo", "name": "lervo" },
                { "projectId": "prj_interface_shiflo", "name": "shiflo" },
            ] }),
            _ => return Err(Failure::new(FailureCode::ApplicationFailed)),
        };
        let Value::Object(result) = result else {
            return Err(Failure::new(FailureCode::ApplicationFailed));
        };
        Ok(CommandOutcome {
            result,
            launch: None,
        })
    }
}

fn listed(workspace: &Workspace, mode: ConversationMode) -> Value {
    json!({
        "workspaceId": workspace.id,
        "projectId": workspace.project,
        "repositoryName": workspace.repository,
        "branch": workspace.branch,
        "title": workspace.title,
        "provider": "claude",
        "conversationMode": mode.code(),
        "sessionId": workspace.session,
        "preparedAt": "2026-11-23T00:00:00.000Z",
    })
}

/// Decodes the scripted providers: each reply starts a turn with the user's message and a
/// streaming agent message, each output line extends it, and the turn-end line completes it. A
/// stopped turn ends with the `turn_stopped` notice, as the Claude decoder's does.
#[derive(Default)]
pub struct ScriptDecoder {
    /// Bytes after the last complete line.
    partial: Vec<u8>,
    in_turn: bool,
    stopping: bool,
}

impl StreamDecoder for ScriptDecoder {
    async fn send(&mut self, text: &str) -> (Vec<u8>, Vec<Decoded>) {
        let now = now_ms();
        self.in_turn = true;
        (
            format!("{text}\n").into_bytes(),
            vec![
                Decoded::Status(SessionEvent::TurnStarted),
                Decoded::Conversation(Input::Item {
                    content: Content::UserMessage {
                        text: text.to_owned(),
                        images: None,
                    },
                    created_at_ms: now,
                }),
                Decoded::Conversation(Input::Start {
                    content: Content::AgentMessage(String::new()),
                    created_at_ms: now,
                }),
            ],
        )
    }

    async fn output(&mut self, bytes: &[u8]) -> Vec<Decoded> {
        self.partial.extend_from_slice(bytes);
        let Some(end) = self.partial.iter().rposition(|byte| *byte == b'\n') else {
            return Vec::new();
        };
        let complete: Vec<u8> = self.partial.drain(..=end).collect();
        let text = String::from_utf8_lossy(&complete);
        let mut decoded = Vec::new();
        for line in text.split_inclusive('\n') {
            if line.trim_end() == TURN_END {
                decoded.push(Decoded::Conversation(Input::Finish));
                if std::mem::take(&mut self.stopping) {
                    decoded.push(Decoded::Conversation(Input::Item {
                        content: Content::LervoNotice {
                            code: "turn_stopped".to_owned(),
                            parameters: Default::default(),
                        },
                        created_at_ms: now_ms(),
                    }));
                }
                self.in_turn = false;
                decoded.push(Decoded::Status(SessionEvent::TurnFinished));
            } else {
                decoded.push(Decoded::Conversation(Input::Delta(line.to_owned())));
            }
        }
        decoded
    }

    async fn interrupt(&mut self) -> Result<(Vec<u8>, Vec<Decoded>), Failure> {
        if !self.in_turn {
            return Ok((Vec::new(), Vec::new()));
        }
        self.stopping = true;
        Ok((format!("{STOP_LINE}\n").into_bytes(), Vec::new()))
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| {
            u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
        })
}

fn now_us() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_micros())
}

/// The echoing provider. It answers each reply with the reply itself. A reply that starts with
/// `slow` writes a line every `SLOW_INTERVAL` instead, until the stop line arrives, so Stop can
/// be checked in the real window.
pub fn echo() -> ExitCode {
    let (sender, lines) = std::sync::mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            if sender.send(line).is_err() {
                break;
            }
        }
    });
    let mut out = std::io::stdout().lock();
    let mut queued = VecDeque::new();
    loop {
        let line = match queued.pop_front() {
            Some(line) => line,
            None => match lines.recv() {
                Ok(line) => line,
                Err(_) => return ExitCode::SUCCESS,
            },
        };
        if line == STOP_LINE {
            continue;
        }
        if !line.starts_with(SLOW_REPLY) {
            if writeln!(out, "{line}\n{TURN_END}")
                .and_then(|()| out.flush())
                .is_err()
            {
                return ExitCode::FAILURE;
            }
            continue;
        }
        for written in 0..SLOW_LINES {
            match lines.recv_timeout(SLOW_INTERVAL) {
                Ok(next) if next == STOP_LINE => break,
                Ok(next) => queued.push_back(next),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return ExitCode::SUCCESS,
            }
            if writeln!(out, "Line {written} of a slow reply.")
                .and_then(|()| out.flush())
                .is_err()
            {
                return ExitCode::FAILURE;
            }
        }
        if writeln!(out, "{TURN_END}")
            .and_then(|()| out.flush())
            .is_err()
        {
            return ExitCode::FAILURE;
        }
    }
}

/// The streaming provider. After each line on stdin it writes `STREAM_DELTAS` lines on a fixed
/// schedule, each starting with `t` and the microseconds since the epoch when it was written,
/// then the turn-end line.
pub fn emit() -> ExitCode {
    let mut out = std::io::stdout().lock();
    for line in std::io::stdin().lock().lines() {
        if line.is_err() {
            return ExitCode::FAILURE;
        }
        let started = Instant::now();
        for delta in 0..STREAM_DELTAS {
            let due = started + STREAM_INTERVAL * delta;
            if let Some(wait) = due.checked_duration_since(Instant::now()) {
                std::thread::sleep(wait);
            }
            if writeln!(out, "t{} streamed text for the interface", now_us())
                .and_then(|()| out.flush())
                .is_err()
            {
                return ExitCode::FAILURE;
            }
        }
        if writeln!(out, "{TURN_END}")
            .and_then(|()| out.flush())
            .is_err()
        {
            return ExitCode::FAILURE;
        }
    }
    ExitCode::SUCCESS
}
