//! The session host end to end over a real socket, with a fake core.

// A failing setup step should stop the test at once, so this test file may unwrap.
#![allow(clippy::unwrap_used)]
#![cfg(unix)]

use std::path::PathBuf;
use std::time::Duration;

use lervo_session_core::ports::{
    CommandOutcome, ConversationMode, Core, Decoded, Failure, FailureCode, Launch, StreamDecoder,
    TranscriptPage,
};
use lervo_session_core::status::SessionEvent;
use lervo_session_core::transcript::{Content, Input};
use lervo_session_host::paths::Layout;
use lervo_session_host::serve::{ServeError, run};
use lervo_session_protocol::codec::MessageCodec;
use lervo_session_protocol::{
    ClientMessage, ConversationItem, HostMessage, SessionStatusMessageStatus,
};
use lervo_session_transport::client::{ClientIdentity, hello};
use lervo_session_transport::framed::{FrameReader, FrameWriter, Incoming};
use lervo_session_transport::handshake::HostIdentity;
use lervo_session_transport::token;
use serde_json::{Map, Value, json};
use tokio::io::AsyncWriteExt;
use tokio::net::UnixStream;
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::sync::oneshot;

struct FakeCore;

/// The exits that sessions reported to the fake core, by session.
static EXITS: std::sync::Mutex<Vec<(String, Option<u8>)>> = std::sync::Mutex::new(Vec::new());

/// Where the provider of `wks_term` notes that it received SIGTERM.
fn term_marker() -> PathBuf {
    std::env::temp_dir().join(format!("lervo-term-marker-{}", std::process::id()))
}

/// Answers each line `X` the fake provider prints as `reply:X` with one streamed agent turn.
#[derive(Default)]
struct LineDecoder {
    partial: Vec<u8>,
}

impl StreamDecoder for LineDecoder {
    async fn send(&mut self, text: &str) -> (Vec<u8>, Vec<Decoded>) {
        let shown = Decoded::Conversation(Input::Item {
            content: Content::UserMessage {
                text: text.to_owned(),
                images: None,
            },
            created_at_ms: 1,
        });
        (format!("{text}\n").into_bytes(), vec![shown])
    }

    async fn output(&mut self, bytes: &[u8]) -> Vec<Decoded> {
        self.partial.extend_from_slice(bytes);
        let mut decoded = Vec::new();
        while let Some(end) = self.partial.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = self.partial.drain(..=end).collect();
            let line = String::from_utf8_lossy(&line[..end]).into_owned();
            let Some(reply) = line.strip_prefix("reply:") else {
                continue;
            };
            decoded.extend([
                Decoded::Status(SessionEvent::TurnStarted),
                Decoded::Conversation(Input::Start {
                    content: Content::AgentMessage(String::new()),
                    created_at_ms: 2,
                }),
                Decoded::Conversation(Input::Delta(reply.to_owned())),
                Decoded::Conversation(Input::Finish),
                Decoded::Status(SessionEvent::TurnFinished),
            ]);
        }
        decoded
    }

    /// Stops a turn with a line the fake provider answers like any other.
    async fn interrupt(&mut self) -> Result<(Vec<u8>, Vec<Decoded>), Failure> {
        Ok((b"stop-turn\n".to_vec(), Vec::new()))
    }
}

impl Core for FakeCore {
    type Decoder = LineDecoder;

    fn decoder(&self, _launch: &Launch) -> LineDecoder {
        LineDecoder::default()
    }

    async fn open(
        &self,
        workspace_id: &str,
        _mode: Option<ConversationMode>,
    ) -> Result<Launch, Failure> {
        if workspace_id == "wks_switch" {
            let mode = _mode.unwrap_or(ConversationMode::Cli);
            return Ok(Launch {
                session_id: "ses_switch".to_owned(),
                workspace_id: workspace_id.to_owned(),
                mode,
                program: "/bin/sh".to_owned(),
                arguments: vec!["-c".to_owned(), "while read line; do :; done".to_owned()],
                environment: Vec::new(),
                working_directory: std::env::temp_dir(),
                provider: "fake".to_owned(),
                initial_input: None,
                initial_images: Vec::new(),
                environment_remove: Vec::new(),
                transcript: false,
            });
        }
        if workspace_id == "wks_sync" {
            return Ok(Launch {
                session_id: "ses_sync".to_owned(),
                workspace_id: workspace_id.to_owned(),
                mode: ConversationMode::Native,
                program: "/bin/sh".to_owned(),
                arguments: vec!["-c".to_owned(), "while read line; do :; done".to_owned()],
                environment: Vec::new(),
                working_directory: std::env::temp_dir(),
                provider: "fake".to_owned(),
                initial_input: None,
                initial_images: Vec::new(),
                environment_remove: Vec::new(),
                transcript: true,
            });
        }
        if workspace_id == "wks_term" {
            // A provider that runs its own shutdown on SIGTERM, as Claude Code runs SessionEnd.
            let script = format!(
                "trap 'echo term > {}; exit 3' TERM; while :; do sleep 0.1; done",
                term_marker().display()
            );
            return Ok(Launch {
                session_id: "ses_term".to_owned(),
                workspace_id: workspace_id.to_owned(),
                mode: ConversationMode::Native,
                program: "/bin/sh".to_owned(),
                arguments: vec!["-c".to_owned(), script],
                environment: Vec::new(),
                working_directory: std::env::temp_dir(),
                provider: "fake".to_owned(),
                initial_input: None,
                initial_images: Vec::new(),
                environment_remove: Vec::new(),
                transcript: false,
            });
        }
        if workspace_id == "wks_missing" {
            return Ok(Launch {
                session_id: "ses_missing_cli".to_owned(),
                workspace_id: workspace_id.to_owned(),
                mode: ConversationMode::Cli,
                program: "lervo-no-such-program".to_owned(),
                arguments: Vec::new(),
                environment: Vec::new(),
                working_directory: std::env::temp_dir(),
                provider: "fake".to_owned(),
                initial_input: None,
                initial_images: Vec::new(),
                environment_remove: Vec::new(),
                transcript: false,
            });
        }
        let (session_id, mode, script) = match workspace_id {
            "wks_1" => (
                "ses_1",
                ConversationMode::Cli,
                "printf hello-from-cli; sleep 0.3",
            ),
            "wks_native" => (
                "ses_native",
                ConversationMode::Native,
                "while read line; do printf 'reply:%s\\n' \"$line\"; done",
            ),
            _ => return Err(Failure::new(FailureCode::WorkspaceStartFailed)),
        };
        Ok(Launch {
            session_id: session_id.to_owned(),
            workspace_id: workspace_id.to_owned(),
            mode,
            program: "/bin/sh".to_owned(),
            arguments: vec!["-c".to_owned(), script.to_owned()],
            environment: Vec::new(),
            working_directory: std::env::temp_dir(),
            provider: "fake".to_owned(),
            initial_input: None,
            initial_images: Vec::new(),
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

    async fn session_exited(&self, session_id: &str, exit_code: Option<u8>) {
        EXITS
            .lock()
            .unwrap()
            .push((session_id.to_owned(), exit_code));
    }

    /// The transcript of `wks_sync`: turns from the CLI conversation, served one item per page.
    async fn transcript(
        &self,
        workspace_id: &str,
        offset: u64,
        _limit: u64,
    ) -> Result<TranscriptPage, Failure> {
        if workspace_id != "wks_sync" {
            return Ok(TranscriptPage::empty());
        }
        let items = [
            Content::UserMessage {
                text: "from the terminal".to_owned(),
                images: None,
            },
            Content::AgentMessage("answered there".to_owned()),
        ];
        let at = usize::try_from(offset).unwrap();
        Ok(TranscriptPage {
            items: items
                .get(at)
                .map(|content| Input::Item {
                    content: content.clone(),
                    created_at_ms: 1 + offset,
                })
                .into_iter()
                .collect(),
            complete: at + 1 >= items.len(),
        })
    }
}

fn identity() -> HostIdentity {
    HostIdentity {
        host_id: "host_test".to_owned(),
        name: "lervo-session-host".to_owned(),
        version: "0.1.0".to_owned(),
    }
}

struct Client {
    reader: FrameReader<OwnedReadHalf>,
    writer: FrameWriter<OwnedWriteHalf>,
    codec: MessageCodec,
}

impl Client {
    async fn connect(layout: &Layout) -> Self {
        let stream = UnixStream::connect(&layout.socket).await.unwrap();
        let (read, write) = stream.into_split();
        let mut client = Self {
            reader: FrameReader::new(read),
            writer: FrameWriter::new(write),
            codec: MessageCodec::new().unwrap(),
        };
        let token = token::read(&layout.token).unwrap();
        let identity = ClientIdentity {
            name: "lervo-ade".to_owned(),
            version: "0.1.0".to_owned(),
        };
        hello(
            &mut client.reader,
            &mut client.writer,
            &client.codec,
            &token,
            &identity,
        )
        .await
        .unwrap();
        client
    }

    async fn send(&mut self, message: Value) {
        let message: ClientMessage = serde_json::from_value(message).unwrap();
        self.writer.control(&message).await.unwrap();
    }

    async fn next(&mut self) -> Incoming {
        tokio::time::timeout(Duration::from_secs(10), self.reader.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap()
    }

    async fn next_message(&mut self) -> HostMessage {
        loop {
            if let Incoming::Control(payload) = self.next().await {
                return self.codec.decode_host(&payload).unwrap();
            }
        }
    }

    /// Collects terminal output until the session reports `ended`.
    async fn until_ended(&mut self) -> String {
        let mut output = Vec::new();
        loop {
            match self.next().await {
                Incoming::Terminal { bytes, .. } => output.extend(bytes),
                Incoming::Control(payload) => {
                    if let HostMessage::SessionStatusMessage(status) =
                        self.codec.decode_host(&payload).unwrap()
                        && status.status == SessionStatusMessageStatus::Ended
                    {
                        return String::from_utf8_lossy(&output).into_owned();
                    }
                }
            }
        }
    }
}

async fn started(
    state: PathBuf,
) -> (
    Layout,
    oneshot::Sender<()>,
    tokio::task::JoinHandle<Result<(), ServeError>>,
) {
    let layout = Layout::at(state);
    let (stop, stopped) = oneshot::channel::<()>();
    let serving = {
        let layout = layout.clone();
        tokio::spawn(async move {
            run(&layout, FakeCore, identity(), async {
                let _ = stopped.await;
            })
            .await
        })
    };
    // The socket file appears at bind, a moment before the listener accepts, so readiness is a
    // connection that succeeds.
    for _ in 0..200 {
        if layout.token.exists() && UnixStream::connect(&layout.socket).await.is_ok() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    (layout, stop, serving)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn runs_a_cli_session_and_replays_it_after_reconnecting() {
    let directory = tempfile::tempdir().unwrap();
    let (layout, stop, serving) = started(directory.path().join("host")).await;

    let mut client = Client::connect(&layout).await;
    client
        .send(json!({"kind": "session.open", "requestId": "req_1", "workspaceId": "wks_1"}))
        .await;
    let HostMessage::SessionOpenedMessage(opened) = client.next_message().await else {
        panic!("expected session.opened")
    };
    assert_eq!(opened.session_id.as_str(), "ses_1");
    client.send(json!({"kind": "session.attach", "requestId": "req_2", "sessionId": "ses_1", "afterSequence": 0})).await;
    assert!(client.until_ended().await.contains("hello-from-cli"));

    let mut again = Client::connect(&layout).await;
    again.send(json!({"kind": "session.attach", "requestId": "req_3", "sessionId": "ses_1", "afterSequence": 0})).await;
    let replayed = again.until_ended().await;
    assert!(replayed.contains("hello-from-cli"));

    again.send(json!({"kind": "conversation.range", "requestId": "req_4", "sessionId": "ses_1", "direction": "before", "limit": 50})).await;
    assert!(
        matches!(again.next_message().await, HostMessage::ConversationPageMessage(page) if page.items.is_empty())
    );

    stop.send(()).unwrap();
    serving.await.unwrap().unwrap();
    assert!(!layout.socket.exists());
    assert!(!layout.token.exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reports_failures_with_protocol_codes() {
    let directory = tempfile::tempdir().unwrap();
    let (layout, stop, serving) = started(directory.path().join("host")).await;
    let mut client = Client::connect(&layout).await;

    client
        .send(json!({"kind": "session.open", "requestId": "req_1", "workspaceId": "wks_unknown"}))
        .await;
    let HostMessage::RequestFailedMessage(failed) = client.next_message().await else {
        panic!("expected request.failed")
    };
    assert_eq!(
        serde_json::to_value(failed.code).unwrap(),
        json!("workspace_start_failed")
    );

    client.send(json!({"kind": "application.command", "requestId": "req_2", "command": "workspace.start", "arguments": {}})).await;
    let HostMessage::RequestFailedMessage(failed) = client.next_message().await else {
        panic!("expected request.failed")
    };
    assert_eq!(
        serde_json::to_value(failed.code).unwrap(),
        json!("application_unavailable")
    );

    client.send(json!({"kind": "session.attach", "requestId": "req_3", "sessionId": "ses_missing", "afterSequence": 0})).await;
    let HostMessage::RequestFailedMessage(failed) = client.next_message().await else {
        panic!("expected request.failed")
    };
    assert_eq!(
        serde_json::to_value(failed.code).unwrap(),
        json!("session_not_found")
    );

    client
        .send(json!({"kind": "session.open", "requestId": "req_4", "workspaceId": "wks_missing"}))
        .await;
    let HostMessage::RequestFailedMessage(failed) = client.next_message().await else {
        panic!("expected request.failed")
    };
    assert_eq!(
        serde_json::to_value(failed.code).unwrap(),
        json!("provider_cli_unavailable")
    );

    stop.send(()).unwrap();
    serving.await.unwrap().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn lets_only_one_session_host_run_per_state_directory() {
    let directory = tempfile::tempdir().unwrap();
    let state = directory.path().join("host");
    let (layout, stop, serving) = started(state.clone()).await;
    let second = run(&layout, FakeCore, identity(), async {}).await;
    assert!(matches!(second, Err(ServeError::AlreadyRunning)));
    stop.send(()).unwrap();
    serving.await.unwrap().unwrap();
}

fn texts(items: &[ConversationItem]) -> Vec<String> {
    items
        .iter()
        .map(|item| match item {
            ConversationItem::UserMessageItem(item) => format!("user:{}", *item.text),
            ConversationItem::AgentMessageItem(item) => format!("agent:{}", *item.text),
            other => format!("other:{other:?}"),
        })
        .collect()
}

/// The code of the `request.failed` that answers `request`, skipping other messages.
async fn failure_for(client: &mut Client, request: &str) -> Value {
    loop {
        if let HostMessage::RequestFailedMessage(failed) = client.next_message().await
            && failed.request_id.as_str() == request
        {
            return serde_json::to_value(failed.code).unwrap();
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refuses_an_empty_message_and_images_a_decoder_cannot_carry() {
    let directory = tempfile::tempdir().unwrap();
    let (layout, stop, serving) = started(directory.path().join("host")).await;
    let mut client = Client::connect(&layout).await;
    client
        .send(json!({"kind": "session.open", "requestId": "req_1", "workspaceId": "wks_native"}))
        .await;
    let HostMessage::SessionOpenedMessage(_) = client.next_message().await else {
        panic!("expected session.opened")
    };
    client
        .send(json!({"kind": "session.send", "requestId": "req_2", "sessionId": "ses_native", "text": ""}))
        .await;
    assert_eq!(
        failure_for(&mut client, "req_2").await,
        json!("message_empty")
    );
    client
        .send(json!({
            "kind": "session.send",
            "requestId": "req_3",
            "sessionId": "ses_native",
            "text": "See this",
            "images": [{"mediaType": "image/png", "data": "iVBORw0KGgo="}],
        }))
        .await;
    assert_eq!(
        failure_for(&mut client, "req_3").await,
        json!("images_unsupported")
    );
    stop.send(()).unwrap();
    serving.await.unwrap().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn runs_a_native_session_and_pages_its_stored_conversation() {
    let directory = tempfile::tempdir().unwrap();
    let (layout, stop, serving) = started(directory.path().join("host")).await;
    let mut client = Client::connect(&layout).await;
    client
        .send(json!({"kind": "session.open", "requestId": "req_1", "workspaceId": "wks_native"}))
        .await;
    let HostMessage::SessionOpenedMessage(opened) = client.next_message().await else {
        panic!("expected session.opened")
    };
    assert_eq!(
        opened.conversation_mode,
        lervo_session_protocol::ConversationMode::Native
    );
    client
        .send(json!({"kind": "session.attach", "requestId": "req_2", "sessionId": "ses_native", "afterSequence": 0}))
        .await;
    client
        .send(json!({"kind": "session.send", "requestId": "req_3", "sessionId": "ses_native", "text": "hi"}))
        .await;

    let (mut deltas, mut completed, mut statuses) = (String::new(), Vec::new(), Vec::new());
    let mut sent = None;
    while completed.len() < 2 || statuses.last() != Some(&SessionStatusMessageStatus::Idle) {
        match client.next_message().await {
            HostMessage::SessionSentMessage(acknowledged) => sent = Some(acknowledged),
            HostMessage::ConversationDeltaMessage(delta) => deltas.push_str(&delta.append),
            HostMessage::ConversationAppendedMessage(appended) => completed.extend(
                appended
                    .items
                    .into_iter()
                    .filter(|item| !format!("{item:?}").contains("Streaming")),
            ),
            HostMessage::SessionStatusMessage(status) => statuses.push(status.status),
            other => panic!("unexpected {other:?}"),
        }
    }
    // The text reached the provider, so the request is answered rather than left to time out.
    let sent = sent.expect("session.sent answers session.send");
    assert_eq!(sent.request_id.as_str(), "req_3");
    assert_eq!(sent.session_id.as_str(), "ses_native");
    assert_eq!(deltas, "hi");
    assert_eq!(texts(&completed), ["user:hi", "agent:hi"]);
    assert!(statuses.contains(&SessionStatusMessageStatus::Working));

    let mut again = Client::connect(&layout).await;
    again
        .send(json!({"kind": "conversation.range", "requestId": "req_4", "sessionId": "ses_native", "direction": "before", "limit": 50}))
        .await;
    let HostMessage::ConversationPageMessage(page) = again.next_message().await else {
        panic!("expected conversation.page")
    };
    assert_eq!(texts(&page.items), ["user:hi", "agent:hi"]);
    assert!(!page.has_earlier && !page.has_later);
    assert!(layout.indexes.join("ses_native").exists());

    again
        .send(json!({"kind": "conversation.range", "requestId": "req_5", "sessionId": "ses_native", "direction": "after", "anchorItemId": "i99", "limit": 50}))
        .await;
    let HostMessage::RequestFailedMessage(failed) = again.next_message().await else {
        panic!("expected request.failed")
    };
    assert_eq!(
        serde_json::to_value(failed.code).unwrap(),
        json!("range_invalid")
    );

    stop.send(()).unwrap();
    serving.await.unwrap().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stops_a_native_turn_and_refuses_in_the_cli_conversation() {
    let directory = tempfile::tempdir().unwrap();
    let (layout, stop, serving) = started(directory.path().join("host")).await;
    let mut client = Client::connect(&layout).await;
    client
        .send(json!({"kind": "session.open", "requestId": "req_1", "workspaceId": "wks_native"}))
        .await;
    let HostMessage::SessionOpenedMessage(_) = client.next_message().await else {
        panic!("expected session.opened")
    };
    client
        .send(json!({"kind": "session.attach", "requestId": "req_2", "sessionId": "ses_native", "afterSequence": 0}))
        .await;
    client
        .send(json!({"kind": "session.interrupt", "requestId": "req_3", "sessionId": "ses_native"}))
        .await;
    // The decoder's bytes reach the provider, which answers them, and the request is answered.
    let (mut interrupted, mut replies) = (None, String::new());
    while interrupted.is_none() || !replies.contains("stop-turn") {
        match client.next_message().await {
            HostMessage::SessionInterruptedMessage(answer) => interrupted = Some(answer),
            HostMessage::ConversationDeltaMessage(delta) => replies.push_str(&delta.append),
            HostMessage::ConversationAppendedMessage(_) | HostMessage::SessionStatusMessage(_) => {}
            other => panic!("unexpected {other:?}"),
        }
    }
    let interrupted = interrupted.unwrap();
    assert_eq!(interrupted.request_id.as_str(), "req_3");
    assert_eq!(interrupted.session_id.as_str(), "ses_native");

    // The CLI conversation stops a turn in its terminal, so the request is refused by name.
    let mut cli = Client::connect(&layout).await;
    cli.send(json!({"kind": "session.open", "requestId": "req_4", "workspaceId": "wks_switch"}))
        .await;
    let HostMessage::SessionOpenedMessage(opened) = cli.next_message().await else {
        panic!("expected session.opened")
    };
    cli.send(json!({"kind": "session.interrupt", "requestId": "req_5", "sessionId": opened.session_id.as_str()}))
        .await;
    let HostMessage::RequestFailedMessage(failed) = cli.next_message().await else {
        panic!("expected request.failed")
    };
    assert_eq!(failed.request_id.as_str(), "req_5");
    assert_eq!(
        serde_json::to_value(failed.code).unwrap(),
        json!("interrupt_unsupported")
    );

    stop.send(()).unwrap();
    serving.await.unwrap().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reports_every_session_status_to_a_watching_connection_without_output() {
    let directory = tempfile::tempdir().unwrap();
    let (layout, stop, serving) = started(directory.path().join("host")).await;
    let mut watcher = Client::connect(&layout).await;
    watcher.send(json!({"kind": "sessions.watch"})).await;

    let mut opener = Client::connect(&layout).await;
    opener
        .send(json!({"kind": "session.open", "requestId": "req_1", "workspaceId": "wks_1"}))
        .await;
    assert!(matches!(
        opener.next_message().await,
        HostMessage::SessionOpenedMessage(_)
    ));

    let mut statuses = Vec::new();
    while statuses.last() != Some(&SessionStatusMessageStatus::Ended) {
        match watcher.next().await {
            Incoming::Control(payload) => match watcher.codec.decode_host(&payload).unwrap() {
                HostMessage::SessionStatusMessage(status) => {
                    assert_eq!(status.session_id.as_str(), "ses_1");
                    statuses.push(status.status);
                }
                other => panic!("unexpected {other:?}"),
            },
            Incoming::Terminal { .. } => panic!("a watching connection received output"),
        }
    }
    assert_eq!(statuses.first(), Some(&SessionStatusMessageStatus::Idle));

    let mut late = Client::connect(&layout).await;
    late.send(json!({"kind": "sessions.watch"})).await;
    let HostMessage::SessionStatusMessage(snapshot) = late.next_message().await else {
        panic!("expected the current status")
    };
    assert_eq!(snapshot.status, SessionStatusMessageStatus::Ended);

    stop.send(()).unwrap();
    serving.await.unwrap().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reuses_a_running_session_and_switches_its_mode_by_restarting_it() {
    let directory = tempfile::tempdir().unwrap();
    let (layout, stop, serving) = started(directory.path().join("host")).await;
    let mut client = Client::connect(&layout).await;
    let open = |request: &str, mode: Option<&str>| {
        let mut message =
            json!({"kind": "session.open", "requestId": request, "workspaceId": "wks_switch"});
        if let Some(mode) = mode {
            message["conversationMode"] = json!(mode);
        }
        message
    };
    client.send(open("req_1", None)).await;
    let HostMessage::SessionOpenedMessage(first) = client.next_message().await else {
        panic!("expected session.opened")
    };
    client.send(open("req_2", Some("cli"))).await;
    let HostMessage::SessionOpenedMessage(again) = client.next_message().await else {
        panic!("expected session.opened")
    };
    assert_eq!(
        (again.session_id.as_str(), again.channel),
        (first.session_id.as_str(), first.channel)
    );

    client.send(open("req_3", Some("native"))).await;
    let HostMessage::SessionOpenedMessage(switched) = client.next_message().await else {
        panic!("expected session.opened")
    };
    assert_eq!(
        switched.conversation_mode,
        lervo_session_protocol::ConversationMode::Native
    );
    assert_eq!(switched.session_id.as_str(), "ses_switch");
    assert_ne!(switched.channel, first.channel);

    stop.send(()).unwrap();
    serving.await.unwrap().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn shows_turns_from_the_provider_transcript_in_the_native_conversation() {
    let directory = tempfile::tempdir().unwrap();
    let (layout, stop, serving) = started(directory.path().join("host")).await;
    let mut client = Client::connect(&layout).await;
    client
        .send(json!({"kind": "session.open", "requestId": "req_1", "workspaceId": "wks_sync"}))
        .await;
    assert!(matches!(
        client.next_message().await,
        HostMessage::SessionOpenedMessage(_)
    ));
    client.send(json!({"kind": "conversation.range", "requestId": "req_2", "sessionId": "ses_sync", "direction": "before", "limit": 50})).await;
    let HostMessage::ConversationPageMessage(page) = client.next_message().await else {
        panic!("expected conversation.page")
    };
    let texts: Vec<String> = page
        .items
        .iter()
        .map(|item| {
            serde_json::to_value(item).unwrap()["text"]
                .as_str()
                .unwrap_or_default()
                .to_owned()
        })
        .collect();
    assert_eq!(texts, ["from the terminal", "answered there"]);

    stop.send(()).unwrap();
    serving.await.unwrap().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn keeps_a_diagnostics_log_of_codes_without_bodies() {
    let directory = tempfile::tempdir().unwrap();
    let (layout, stop, serving) = started(directory.path().join("host")).await;

    // A connection that breaks the handshake, and a request that fails.
    let mut broken = UnixStream::connect(&layout.socket).await.unwrap();
    broken.write_all(b"not a frame\n").await.unwrap();
    drop(broken);
    let mut client = Client::connect(&layout).await;
    client
        .send(json!({"kind": "session.attach", "requestId": "req_1", "sessionId": "ses_secret_text", "afterSequence": 0}))
        .await;
    let HostMessage::RequestFailedMessage(_) = client.next_message().await else {
        panic!("expected request.failed")
    };
    drop(client);

    // The writer thread appends in the background, so wait for every entry this test checks,
    // not only the connection ends: on a slow runner they can show first.
    let mut log = String::new();
    for _ in 0..500 {
        log = std::fs::read_to_string(&layout.diagnostics).unwrap_or_default();
        if log.matches("connection.ended").count() >= 2 && log.contains("session_not_found") {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let entries: Vec<Value> = log
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let events: Vec<&str> = entries
        .iter()
        .map(|entry| entry["event"].as_str().unwrap())
        .collect();
    assert_eq!(events.first(), Some(&"host.started"));
    assert!(
        entries.iter().any(|entry| entry["event"] == "request.failed"
            && entry["code"] == "session_not_found"),
        "{log}"
    );
    let ended: Vec<&Value> = entries
        .iter()
        .filter(|entry| entry["event"] == "connection.ended")
        .collect();
    assert_eq!(ended.len(), 2, "{log}");
    assert!(ended.iter().any(|entry| entry["code"] != "closed"));
    // Requests' contents never reach the log.
    assert!(!log.contains("ses_secret_text") && !log.contains("not a frame"));

    stop.send(()).unwrap();
    serving.await.unwrap().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stops_a_provider_with_sigterm_and_reports_its_exit() {
    let _ = std::fs::remove_file(term_marker());
    let directory = tempfile::tempdir().unwrap();
    let (layout, stop, serving) = started(directory.path().join("host")).await;
    let mut client = Client::connect(&layout).await;
    client
        .send(json!({"kind": "session.open", "requestId": "req_1", "workspaceId": "wks_term"}))
        .await;
    assert!(matches!(
        client.next_message().await,
        HostMessage::SessionOpenedMessage(_)
    ));
    // Let the shell install its trap before it is asked to end.
    tokio::time::sleep(Duration::from_millis(300)).await;
    client
        .send(json!({"kind": "session.stop", "requestId": "req_2", "sessionId": "ses_term"}))
        .await;
    let reported = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let found = EXITS
                .lock()
                .unwrap()
                .iter()
                .find(|(session, _)| session == "ses_term")
                .cloned();
            if let Some(found) = found {
                return found;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("the session reports its exit");
    // SIGTERM reached the provider, which ran its shutdown and chose its exit code.
    assert_eq!(reported, ("ses_term".to_owned(), Some(3)));
    assert_eq!(
        std::fs::read_to_string(term_marker()).unwrap().trim(),
        "term"
    );
    let _ = std::fs::remove_file(term_marker());

    stop.send(()).unwrap();
    serving.await.unwrap().unwrap();
}
