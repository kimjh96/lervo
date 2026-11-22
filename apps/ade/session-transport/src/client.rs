//! The client side of the handshake, used by the desktop shell and by tests.

use tokio::io::{AsyncRead, AsyncWrite};

use lervo_session_protocol::codec::MessageCodec;
use lervo_session_protocol::{
    ClientMessage, HelloMessage, HelloMessageClient, HelloMessageClientName,
    HelloMessageClientVersion, HelloMessageKind, HelloMessageToken, HostMessage, WelcomeMessage,
};

use crate::TransportError;
use crate::framed::{FrameReader, FrameWriter, Incoming};
use crate::handshake::{PROTOCOL_VERSION, rejection_code};
use crate::token::Token;

/// The client's name and version, sent in `hello`.
#[derive(Clone, Debug)]
pub struct ClientIdentity {
    pub name: String,
    pub version: String,
}

/// Sends `hello` and returns the session host's `welcome`.
pub async fn hello<R, W>(
    reader: &mut FrameReader<R>,
    writer: &mut FrameWriter<W>,
    codec: &MessageCodec,
    token: &Token,
    identity: &ClientIdentity,
) -> Result<WelcomeMessage, TransportError>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let invalid = |_| TransportError::IdentityInvalid;
    let message = HelloMessage {
        client: HelloMessageClient {
            name: HelloMessageClientName::try_from(identity.name.as_str()).map_err(invalid)?,
            version: HelloMessageClientVersion::try_from(identity.version.as_str())
                .map_err(invalid)?,
        },
        kind: HelloMessageKind::Hello,
        protocol_versions: vec![
            std::num::NonZeroU64::new(PROTOCOL_VERSION).ok_or(TransportError::IdentityInvalid)?,
        ],
        token: HelloMessageToken::try_from(token.as_str()).map_err(invalid)?,
    };
    writer.control(&ClientMessage::from(message)).await?;
    writer.flush().await?;
    let Some(Incoming::Control(payload)) = reader.next().await? else {
        return Err(TransportError::Closed);
    };
    match codec.decode_host(&payload)? {
        HostMessage::WelcomeMessage(welcome) => Ok(welcome),
        HostMessage::RejectedMessage(rejected) => {
            Err(TransportError::Rejected(rejection_code(rejected.code)))
        }
        _ => Err(TransportError::UnexpectedMessage),
    }
}
