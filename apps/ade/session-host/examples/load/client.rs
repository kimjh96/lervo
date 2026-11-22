//! A protocol client for the scenarios, and the percentiles they share.

use std::time::Duration;

use lervo_session_host::paths::Layout;
use lervo_session_protocol::codec::MessageCodec;
use lervo_session_protocol::{ClientMessage, HostMessage};
use lervo_session_transport::client::{ClientIdentity, hello};
use lervo_session_transport::framed::{FrameReader, FrameWriter, Incoming};
use lervo_session_transport::token;
use serde_json::{Value, json};
use tokio::net::UnixStream;
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};

pub struct Client {
    pub reader: FrameReader<OwnedReadHalf>,
    pub writer: FrameWriter<OwnedWriteHalf>,
    pub codec: MessageCodec,
}

impl Client {
    pub async fn connect(layout: &Layout) -> Option<Self> {
        let mut stream = None;
        for _ in 0..200 {
            if layout.token.exists()
                && let Ok(connected) = UnixStream::connect(&layout.socket).await
            {
                stream = Some(connected);
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let (read, write) = stream?.into_split();
        let mut client = Self {
            reader: FrameReader::new(read),
            writer: FrameWriter::new(write),
            codec: MessageCodec::new().ok()?,
        };
        let identity = ClientIdentity {
            name: "lervo-load".to_owned(),
            version: "0.1.0".to_owned(),
        };
        hello(
            &mut client.reader,
            &mut client.writer,
            &client.codec,
            &token::read(&layout.token).ok()?,
            &identity,
        )
        .await
        .ok()?;
        Some(client)
    }

    pub async fn send(&mut self, message: Value) -> Option<()> {
        let message: ClientMessage = serde_json::from_value(message).ok()?;
        self.writer.control(&message).await.ok()
    }

    /// Opens a workspace's session and attaches; returns its session ID and terminal channel.
    pub async fn open(&mut self, workspace: &str) -> Option<(String, u32)> {
        self.send(
            json!({"kind": "session.open", "requestId": "req_open", "workspaceId": workspace}),
        )
        .await?;
        loop {
            if let Incoming::Control(payload) = self.reader.next().await.ok()??
                && let HostMessage::SessionOpenedMessage(opened) =
                    self.codec.decode_host(&payload).ok()?
            {
                {
                    let session = opened.session_id.to_string();
                    self.send(json!({"kind": "session.attach", "requestId": "req_attach", "sessionId": session, "afterSequence": 0})).await?;
                    return Some((session, u32::try_from(opened.channel.get()).ok()?));
                }
            }
        }
    }
}

pub fn percentiles(mut samples: Vec<f64>) -> (f64, f64) {
    samples.sort_by(f64::total_cmp);
    let at = |fraction: f64| {
        samples
            .get(((samples.len().saturating_sub(1)) as f64 * fraction).round() as usize)
            .copied()
            .unwrap_or(0.0)
    };
    (at(0.5), at(0.95))
}
