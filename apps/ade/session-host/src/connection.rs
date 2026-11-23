//! One client connection: the handshake, then messages in and updates out.

use std::sync::Arc;

use lervo_session_transport::TransportError;
use lervo_session_transport::framed::{FrameReader, FrameWriter, Incoming};
use lervo_session_transport::handshake::accept;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::mpsc;

use crate::host::Host;
use crate::subscriber::{Outgoing, Output};
use lervo_session_core::ports::Core;

/// Serves one connection until the client closes it or breaks the protocol.
pub(crate) async fn serve<C, R, W>(
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

    let (sender, mut queue) = mpsc::unbounded_channel::<Outgoing>();
    let output = Output::new(connection, sender).with_diagnostics(host.diagnostics.clone());
    let watching = output.clone();
    let writing = tokio::spawn(async move {
        while let Some(item) = queue.recv().await {
            // A client too far behind on replies closes here; it reconnects and attaches again.
            if watching.overflowed() {
                break;
            }
            let written = match &item {
                Outgoing::Control { payload, .. } => writer.control_payload(payload).await,
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
                Ok(message) => host.handle(&output, message).await,
                Err(error) => break Err(error.into()),
            },
            Ok(Some(Incoming::Terminal { channel, bytes, .. })) => {
                host.input(channel, bytes).await;
            }
            Err(error) => break Err(error),
        }
    };
    host.detach_all(connection).await;
    drop(output);
    let _ = writing.await;
    result
}
