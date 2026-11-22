//! The shell's link to the session host: it starts the session host when none answers, runs the
//! handshake, and relays frames between the socket and the interface (ADR-0613, "The session host
//! owns processes, and the UI only presents").
//!
//! Control messages reach the interface as JSON after the protocol codec validated them, so the
//! interface never parses MessagePack and never sees an unvalidated message. Terminal bytes reach
//! it unchanged, as `[channel: u32][sequence: u64][bytes]`.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use lervo_session_protocol::codec::MessageCodec;
use lervo_session_protocol::{ClientMessage, HostMessage};
use lervo_session_transport::TransportError;
use lervo_session_transport::client::{ClientIdentity, hello};
use lervo_session_transport::framed::{FrameReader, FrameWriter, Incoming};
use lervo_session_transport::paths::Layout;
use lervo_session_transport::token;
use tokio::net::UnixStream;
use tokio::sync::mpsc;

const CONNECT_ATTEMPTS: u32 = 50;
const CONNECT_INTERVAL: Duration = Duration::from_millis(100);
const OUTGOING_QUEUE: usize = 256;

/// What the interface sends.
pub enum Outgoing {
    Control(ClientMessage),
    Terminal { channel: u32, bytes: Vec<u8> },
}

/// What the interface receives.
pub enum Event {
    Control(HostMessage),
    Terminal(Vec<u8>),
    /// The connection ended. The interface reconnects, which starts the session host again.
    Disconnected,
}

/// How to start the session host.
#[derive(Clone)]
pub struct HostProgram {
    pub executable: PathBuf,
    pub path: Option<String>,
}

impl HostProgram {
    /// `LERVO_SESSION_HOST`, or `lervo-session-host` beside the shell's own executable.
    pub fn locate(path: Option<String>) -> Option<Self> {
        let executable = std::env::var_os("LERVO_SESSION_HOST")
            .map(PathBuf::from)
            .or_else(|| {
                let shell = std::env::current_exe().ok()?;
                Some(shell.parent()?.join("lervo-session-host"))
            })?;
        Some(Self { executable, path })
    }

    /// Starts the session host detached from the shell, so it outlives the window. A second
    /// session host finds the lock held and exits at once, so starting one is always safe.
    fn start(&self) -> Result<(), TransportError> {
        let mut command = std::process::Command::new(&self.executable);
        command
            .arg("serve")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if let Some(path) = &self.path {
            command.env("PATH", path);
        }
        command.spawn().map(drop).map_err(TransportError::Io)
    }
}

/// Connects to the session host, starting it if needed, and relays until the connection ends.
pub async fn run(
    program: HostProgram,
    layout: Layout,
    identity: ClientIdentity,
    mut outgoing: mpsc::Receiver<Outgoing>,
    events: impl Fn(Event) + Send + 'static,
) -> Result<(), TransportError> {
    let stream = connect(&program, &layout).await?;
    let codec = MessageCodec::new()?;
    let (read, write) = stream.into_split();
    let (mut reader, mut writer) = (FrameReader::new(read), FrameWriter::new(write));
    let token = token::read(&layout.token)?;
    hello(&mut reader, &mut writer, &codec, &token, &identity).await?;

    let writing = tokio::spawn(async move {
        while let Some(item) = outgoing.recv().await {
            let written = match item {
                Outgoing::Control(message) => writer.control(&message).await,
                Outgoing::Terminal { channel, bytes } => writer.terminal(channel, 0, &bytes).await,
            };
            if written.is_err() {
                break;
            }
        }
    });
    let result = loop {
        match reader.next().await {
            Ok(Some(Incoming::Control(payload))) => match codec.decode_host(&payload) {
                Ok(message) => events(Event::Control(message)),
                Err(error) => break Err(TransportError::from(error)),
            },
            Ok(Some(Incoming::Terminal {
                channel,
                sequence,
                bytes,
            })) => {
                let mut frame = Vec::with_capacity(12 + bytes.len());
                frame.extend_from_slice(&channel.to_be_bytes());
                frame.extend_from_slice(&sequence.to_be_bytes());
                frame.extend_from_slice(&bytes);
                events(Event::Terminal(frame));
            }
            Ok(None) => break Ok(()),
            Err(error) => break Err(error),
        }
    };
    writing.abort();
    events(Event::Disconnected);
    result
}

/// The connected socket, after starting the session host when nothing answers.
async fn connect(program: &HostProgram, layout: &Layout) -> Result<UnixStream, TransportError> {
    if let Ok(stream) = UnixStream::connect(&layout.socket).await {
        return Ok(stream);
    }
    program.start()?;
    for _ in 0..CONNECT_ATTEMPTS {
        tokio::time::sleep(CONNECT_INTERVAL).await;
        if layout.token.exists()
            && let Ok(stream) = UnixStream::connect(&layout.socket).await
        {
            return Ok(stream);
        }
    }
    Err(TransportError::Closed)
}

/// A sender the interface's commands use, replaced on each connection.
pub fn outgoing_queue() -> (mpsc::Sender<Outgoing>, mpsc::Receiver<Outgoing>) {
    mpsc::channel(OUTGOING_QUEUE)
}
