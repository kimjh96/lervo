//! The shell's link to the session host: it connects, starting the session host through
//! `host_program` when none answers, runs the handshake, and relays frames between the socket and
//! the interface (ADR-0613, "The session host owns processes, and the UI only presents").
//!
//! Control messages reach the interface as JSON after the protocol codec validated them, so the
//! interface never parses MessagePack and never sees an unvalidated message. The ADE offers no
//! terminal (ADR-0617), so a terminal frame ends the connection.

use std::time::Duration;

use lervo_session_protocol::codec::MessageCodec;
use lervo_session_protocol::{ClientMessage, HostMessage};
use lervo_session_transport::TransportError;
use lervo_session_transport::client::{ClientIdentity, hello};
use lervo_session_transport::framed::{FrameReader, FrameWriter, Incoming};
use lervo_session_transport::paths::Layout;
use lervo_session_transport::socket::{self, Stream};
use lervo_session_transport::token;
use tokio::sync::mpsc;

use crate::host_program::HostProgram;

const CONNECT_ATTEMPTS: u32 = 50;
const CONNECT_INTERVAL: Duration = Duration::from_millis(100);
const OUTGOING_QUEUE: usize = 256;

/// What the interface sends.
pub enum Outgoing {
    Control(ClientMessage),
}

/// What the interface receives. When `run` returns, the connection ended, and the interface
/// reconnects, which starts the session host again.
pub enum Event {
    /// The handshake completed; it comes before any control message.
    Identified(HostFacts),
    Control(HostMessage),
}

/// What the shell learned about the session host it reached.
pub struct HostFacts {
    /// The version the session host's `welcome` names.
    pub version: String,
    /// The session host's process, as the socket reports its peer. The socket's directory is
    /// owner-only, so the peer is a process of the same user.
    pub process: Option<i32>,
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
    let process = peer_process(&stream);
    let codec = MessageCodec::new()?;
    let (read, write) = stream.into_split();
    let (mut reader, mut writer) = (FrameReader::new(read), FrameWriter::new(write));
    let token = token::read(&layout.token)?;
    let welcome = hello(&mut reader, &mut writer, &codec, &token, &identity).await?;
    events(Event::Identified(HostFacts {
        version: String::from(welcome.host.version),
        process,
    }));

    let writing = tokio::spawn(async move {
        while let Some(item) = outgoing.recv().await {
            let written = match item {
                Outgoing::Control(message) => writer.control(&message).await,
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
            Ok(Some(Incoming::Terminal { .. })) => break Err(TransportError::UnexpectedMessage),
            Ok(None) => break Ok(()),
            Err(error) => break Err(error),
        }
    };
    writing.abort();
    result
}

/// The process at the other end of `stream`, as the socket reports it.
fn peer_process(stream: &Stream) -> Option<i32> {
    stream.peer_cred().ok().and_then(|peer| peer.pid())
}

/// The connected socket, after starting the session host when nothing answers.
async fn connect(program: &HostProgram, layout: &Layout) -> Result<Stream, TransportError> {
    if let Ok(stream) = socket::connect(&layout.socket).await {
        return Ok(stream);
    }
    program.start().await?;
    for _ in 0..CONNECT_ATTEMPTS {
        tokio::time::sleep(CONNECT_INTERVAL).await;
        if layout.token.exists()
            && let Ok(stream) = socket::connect(&layout.socket).await
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

#[cfg(test)]
mod tests {
    use super::peer_process;

    #[test]
    fn the_socket_names_the_process_at_its_other_end() -> std::io::Result<()> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_io()
            .build()?;
        runtime.block_on(async {
            let (ours, _theirs) = tokio::net::UnixStream::pair()?;
            let own = i32::try_from(std::process::id()).ok();
            assert_eq!(peer_process(&ours), own);
            Ok(())
        })
    }
}
