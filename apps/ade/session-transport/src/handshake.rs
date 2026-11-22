//! The handshake (session-host protocol, "Handshake").

use tokio::io::{AsyncRead, AsyncWrite};

use lervo_session_protocol::codec::MessageCodec;
use lervo_session_protocol::{
    ClientMessage, HelloMessage, HostMessage, Identifier, RejectedMessage, RejectedMessageCode,
    RejectedMessageKind, WelcomeMessage, WelcomeMessageHost, WelcomeMessageHostName,
    WelcomeMessageHostVersion, WelcomeMessageKind,
};

use crate::TransportError;
use crate::framed::{FrameReader, FrameWriter, Incoming};
use crate::token::Token;

/// The only protocol version this build speaks.
pub const PROTOCOL_VERSION: u64 = 1;

/// The session host's identity, sent in `welcome`.
#[derive(Clone, Debug)]
pub struct HostIdentity {
    pub host_id: String,
    pub name: String,
    pub version: String,
}

/// Runs the server side: the first message must be `hello` with this build's protocol version and
/// the current token. Answers `welcome`, or `rejected` followed by an error.
pub async fn accept<R, W>(
    reader: &mut FrameReader<R>,
    writer: &mut FrameWriter<W>,
    codec: &MessageCodec,
    token: &Token,
    identity: &HostIdentity,
) -> Result<(), TransportError>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let hello = read_hello(reader, codec).await?;
    let rejection = if !hello
        .protocol_versions
        .iter()
        .any(|version| version.get() == PROTOCOL_VERSION)
    {
        Some(RejectedMessageCode::ProtocolUnsupported)
    } else if !token.matches(&hello.token) {
        Some(RejectedMessageCode::TokenInvalid)
    } else {
        None
    };
    if let Some(code) = rejection {
        let message = HostMessage::from(RejectedMessage {
            code,
            kind: RejectedMessageKind::Rejected,
        });
        writer.control(&message).await?;
        writer.flush().await?;
        return Err(TransportError::Rejected(rejection_code(code)));
    }
    writer
        .control(&HostMessage::from(welcome(identity)?))
        .await?;
    writer.flush().await?;
    Ok(())
}

async fn read_hello<R: AsyncRead + Unpin>(
    reader: &mut FrameReader<R>,
    codec: &MessageCodec,
) -> Result<HelloMessage, TransportError> {
    let Some(Incoming::Control(payload)) = reader.next().await? else {
        return Err(TransportError::UnexpectedMessage);
    };
    match codec.decode_client(&payload)? {
        ClientMessage::HelloMessage(hello) => Ok(hello),
        _ => Err(TransportError::UnexpectedMessage),
    }
}

fn welcome(identity: &HostIdentity) -> Result<WelcomeMessage, TransportError> {
    Ok(WelcomeMessage {
        host: WelcomeMessageHost {
            host_id: Identifier::try_from(identity.host_id.as_str())
                .map_err(|_| TransportError::IdentityInvalid)?,
            name: WelcomeMessageHostName::try_from(identity.name.as_str())
                .map_err(|_| TransportError::IdentityInvalid)?,
            version: WelcomeMessageHostVersion::try_from(identity.version.as_str())
                .map_err(|_| TransportError::IdentityInvalid)?,
        },
        kind: WelcomeMessageKind::Welcome,
        protocol_version: 1,
    })
}

/// The protocol code of a rejection, for errors and logs.
pub fn rejection_code(code: RejectedMessageCode) -> &'static str {
    match code {
        RejectedMessageCode::ProtocolUnsupported => "protocol_unsupported",
        RejectedMessageCode::TokenInvalid => "token_invalid",
    }
}
