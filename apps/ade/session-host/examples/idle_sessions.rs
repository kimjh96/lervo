//! Measures the session host with idle sessions (ADE performance budgets: idle memory, CPU with
//! twenty idle sessions, and memory per idle session).
//!
//! Run with `cargo run --release -p lervo-session-host --example idle_sessions -- [seconds]`. It
//! serves on a temporary socket, opens ten CLI and ten native sessions whose providers wait for
//! input, and prints one JSON line with resident memory before and after and the CPU the process
//! used while every session was idle.

use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

use lervo_session_core::ports::{
    CommandOutcome, ConversationMode, Core, Decoded, Failure, FailureCode, Launch, StreamDecoder,
};
use lervo_session_host::paths::Layout;
use lervo_session_host::serve::run;
use lervo_session_protocol::codec::MessageCodec;
use lervo_session_protocol::{ClientMessage, HostMessage};
use lervo_session_transport::client::{ClientIdentity, hello};
use lervo_session_transport::framed::{FrameReader, FrameWriter, Incoming};
use lervo_session_transport::handshake::HostIdentity;
use lervo_session_transport::token;
use serde_json::{Map, Value, json};
use tokio::net::UnixStream;

const SESSIONS: usize = 20;
const SETTLE: Duration = Duration::from_secs(3);

struct IdleCore;

struct IdleDecoder;

impl StreamDecoder for IdleDecoder {
    async fn send(&mut self, _text: &str) -> (Vec<u8>, Vec<Decoded>) {
        (Vec::new(), Vec::new())
    }

    async fn output(&mut self, _bytes: &[u8]) -> Vec<Decoded> {
        Vec::new()
    }
}

impl Core for IdleCore {
    type Decoder = IdleDecoder;

    fn decoder(&self, _launch: &Launch) -> IdleDecoder {
        IdleDecoder
    }

    async fn open(
        &self,
        workspace_id: &str,
        _mode: Option<ConversationMode>,
    ) -> Result<Launch, Failure> {
        let index: usize = workspace_id
            .trim_start_matches("wks_")
            .parse()
            .map_err(|_| Failure::new(FailureCode::WorkspaceStartFailed))?;
        Ok(Launch {
            session_id: format!("ses_{index}"),
            workspace_id: workspace_id.to_owned(),
            mode: if index.is_multiple_of(2) {
                ConversationMode::Cli
            } else {
                ConversationMode::Native
            },
            program: "/bin/cat".to_owned(),
            arguments: Vec::new(),
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
}

/// Resident memory in KiB and CPU time in milliseconds of this process.
fn usage() -> Option<(u64, u64)> {
    let pid = std::process::id().to_string();
    let output = std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &pid])
        .output()
        .ok()?;
    let rss = String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse()
        .ok()?;
    Some((rss, cpu_milliseconds()?))
}

#[cfg(target_os = "linux")]
fn cpu_milliseconds() -> Option<u64> {
    // Fields 14 and 15 of /proc/self/stat are user and system time in clock ticks of 10 ms.
    let stat = std::fs::read_to_string("/proc/self/stat").ok()?;
    let fields: Vec<&str> = stat.rsplit_once(')')?.1.split_whitespace().collect();
    let ticks: u64 = fields.get(11)?.parse::<u64>().ok()? + fields.get(12)?.parse::<u64>().ok()?;
    Some(ticks * 10)
}

#[cfg(not(target_os = "linux"))]
fn cpu_milliseconds() -> Option<u64> {
    // `ps -o time=` prints minutes:seconds.hundredths on macOS.
    let pid = std::process::id().to_string();
    let output = std::process::Command::new("ps")
        .args(["-o", "time=", "-p", &pid])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let (minutes, seconds) = text.trim().split_once(':')?;
    let seconds: f64 = seconds.parse().ok()?;
    let minutes: u64 = minutes.parse().ok()?;
    Some(minutes * 60_000 + (seconds * 1000.0).round() as u64)
}

async fn measure(state: PathBuf, idle: Duration) -> Option<Value> {
    let layout = Layout::at(state);
    let identity = HostIdentity {
        host_id: "host_measure".to_owned(),
        name: "lervo-session-host".to_owned(),
        version: "0.1.0".to_owned(),
    };
    let serving = {
        let layout = layout.clone();
        tokio::spawn(async move { run(&layout, IdleCore, identity, std::future::pending()).await })
    };
    while !(layout.socket.exists() && layout.token.exists()) {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    // The socket file appears a moment before the listener accepts, so retry the connection.
    let mut stream = None;
    for _ in 0..100 {
        if let Ok(connected) = UnixStream::connect(&layout.socket).await {
            stream = Some(connected);
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let (read, write) = stream?.into_split();
    let (mut reader, mut writer) = (FrameReader::new(read), FrameWriter::new(write));
    let codec = MessageCodec::new().ok()?;
    let client = ClientIdentity {
        name: "lervo-measure".to_owned(),
        version: "0.1.0".to_owned(),
    };
    hello(
        &mut reader,
        &mut writer,
        &codec,
        &token::read(&layout.token).ok()?,
        &client,
    )
    .await
    .ok()?;
    tokio::time::sleep(SETTLE).await;
    let (rss_before, _) = usage()?;

    for index in 0..SESSIONS {
        let open: ClientMessage = serde_json::from_value(json!({"kind": "session.open", "requestId": format!("req_{index}"), "workspaceId": format!("wks_{index}")})).ok()?;
        writer.control(&open).await.ok()?;
        loop {
            if let Some(Incoming::Control(payload)) = reader.next().await.ok()? {
                match codec.decode_host(&payload).ok()? {
                    HostMessage::SessionOpenedMessage(_) => break,
                    HostMessage::RequestFailedMessage(failed) => {
                        eprintln!("session {index} failed: {:?}", failed.code);
                        return None;
                    }
                    // Status updates of sessions opened earlier.
                    _ => {}
                }
            }
        }
        let attach: ClientMessage = serde_json::from_value(json!({"kind": "session.attach", "requestId": format!("att_{index}"), "sessionId": format!("ses_{index}"), "afterSequence": 0})).ok()?;
        writer.control(&attach).await.ok()?;
    }
    tokio::time::sleep(SETTLE).await;
    let (rss_after, cpu_start) = usage()?;
    tokio::time::sleep(idle).await;
    let (rss_end, cpu_end) = usage()?;
    serving.abort();
    let idle_ms = u64::try_from(idle.as_millis()).ok()?;
    Some(json!({
        "sessions": SESSIONS,
        "idleSeconds": idle.as_secs(),
        "rssIdleKiB": rss_before,
        "rssWithSessionsKiB": rss_after,
        "rssAfterIdleKiB": rss_end,
        "rssPerSessionKiB": rss_after.saturating_sub(rss_before) / SESSIONS as u64,
        "cpuMilliseconds": cpu_end.saturating_sub(cpu_start),
        "cpuPercentOfOneCore": (cpu_end.saturating_sub(cpu_start) as f64) * 100.0 / idle_ms as f64,
    }))
}

fn main() -> ExitCode {
    let seconds = std::env::args()
        .nth(1)
        .and_then(|value| value.parse().ok())
        .unwrap_or(60);
    let Ok(directory) = tempfile::tempdir() else {
        return ExitCode::FAILURE;
    };
    let Ok(runtime) = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
    else {
        return ExitCode::FAILURE;
    };
    match runtime.block_on(measure(
        directory.path().join("host"),
        Duration::from_secs(seconds),
    )) {
        Some(result) => {
            println!("{result}");
            ExitCode::SUCCESS
        }
        None => ExitCode::FAILURE,
    }
}
