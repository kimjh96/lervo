//! Frames over an async byte stream (session-host protocol, "Frames").

use serde::Serialize;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use lervo_session_protocol::codec::encode;
use lervo_session_protocol::frame::{self, Frame};

use crate::TransportError;

const READ_CHUNK_BYTES: usize = 64 * 1024;

/// A frame read from the peer.
#[derive(Debug, PartialEq, Eq)]
pub enum Incoming {
    /// A MessagePack control message, not yet validated.
    Control(Vec<u8>),
    /// Terminal bytes for a channel.
    Terminal {
        channel: u32,
        sequence: u64,
        bytes: Vec<u8>,
    },
}

/// Reads frames. The buffer never grows beyond one maximum frame and one read chunk.
pub struct FrameReader<R> {
    inner: R,
    buffer: Vec<u8>,
}

impl<R: AsyncRead + Unpin> FrameReader<R> {
    pub fn new(inner: R) -> Self {
        Self {
            inner,
            buffer: Vec::new(),
        }
    }

    /// The next frame, or `None` when the peer closed the connection between frames.
    pub async fn next(&mut self) -> Result<Option<Incoming>, TransportError> {
        loop {
            if let Some((frame, used)) = frame::decode(&self.buffer)? {
                let incoming = match frame {
                    Frame::Control(payload) => Incoming::Control(payload.to_vec()),
                    Frame::Terminal {
                        channel,
                        sequence,
                        bytes,
                    } => Incoming::Terminal {
                        channel,
                        sequence,
                        bytes: bytes.to_vec(),
                    },
                };
                self.buffer.drain(..used);
                return Ok(Some(incoming));
            }
            let start = self.buffer.len();
            self.buffer.resize(start + READ_CHUNK_BYTES, 0);
            let read = self.inner.read(&mut self.buffer[start..]).await?;
            self.buffer.truncate(start + read);
            if read == 0 {
                return if self.buffer.is_empty() {
                    Ok(None)
                } else {
                    Err(TransportError::Closed)
                };
            }
        }
    }
}

/// Writes frames. One reusable buffer holds the frame being written.
pub struct FrameWriter<W> {
    inner: W,
    buffer: Vec<u8>,
}

impl<W: AsyncWrite + Unpin> FrameWriter<W> {
    pub fn new(inner: W) -> Self {
        Self {
            inner,
            buffer: Vec::new(),
        }
    }

    /// Writes one control message.
    pub async fn control<T: Serialize>(&mut self, message: &T) -> Result<(), TransportError> {
        let payload = encode(message)?;
        self.buffer.clear();
        frame::encode_control(&payload, &mut self.buffer)?;
        self.inner.write_all(&self.buffer).await?;
        Ok(())
    }

    /// Writes terminal bytes for `channel` at `sequence`. The bytes are framed, not re-encoded.
    pub async fn terminal(
        &mut self,
        channel: u32,
        sequence: u64,
        bytes: &[u8],
    ) -> Result<(), TransportError> {
        self.buffer.clear();
        frame::encode_terminal(channel, sequence, bytes, &mut self.buffer)?;
        self.inner.write_all(&self.buffer).await?;
        Ok(())
    }

    /// Flushes buffered bytes to the peer.
    pub async fn flush(&mut self) -> Result<(), TransportError> {
        self.inner.flush().await?;
        Ok(())
    }
}
