//! One client connection: the handshake, then messages in and updates out.

use std::sync::Arc;

use lervo_session_transport::TransportError;
use lervo_session_transport::framed::{FrameReader, FrameWriter, Incoming};
use lervo_session_transport::handshake::accept;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::mpsc;

use crate::host::Host;
use crate::subscriber::Outgoing;
use lervo_session_core::ports::Core;

/// Serves one connection until the client closes it or breaks the protocol.
pub async fn serve<C, R, W>(
    host: Arc<Host<C>>,
    connection: u64,
    read: R,
    write: W,
) -> Result<(), TransportError>
where
    C: Core,
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let mut reader = FrameReader::new(read);
    let mut writer = FrameWriter::new(write);
    accept(
        &mut reader,
        &mut writer,
        &host.codec,
        &host.token,
        &host.identity,
    )
    .await?;

    let (outgoing, mut queue) = mpsc::unbounded_channel::<Outgoing>();
    let writing = tokio::spawn(async move {
        while let Some(item) = queue.recv().await {
            let written = match &item {
                Outgoing::Control { message, .. } => writer.control(message).await,
                Outgoing::Terminal {
                    channel,
                    sequence,
                    bytes,
                    ..
                } => writer.terminal(*channel, *sequence, bytes).await,
            };
            item.release();
            if written.is_err() {
                break;
            }
        }
    });

    let result = loop {
        match reader.next().await {
            Ok(None) => break Ok(()),
            Ok(Some(Incoming::Control(payload))) => match host.codec.decode_client(&payload) {
                Ok(message) => host.handle(connection, message, &outgoing).await,
                Err(error) => break Err(error.into()),
            },
            Ok(Some(Incoming::Terminal { channel, bytes, .. })) => {
                host.input(channel, bytes).await;
            }
            Err(error) => break Err(error),
        }
    };
    host.detach_all(connection).await;
    drop(outgoing);
    let _ = writing.await;
    result
}
