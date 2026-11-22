use lervo_session_protocol::codec::CodecError;
use lervo_session_protocol::frame::FrameError;

/// Why the transport failed. Every case ends the connection.
#[derive(Debug, thiserror::Error)]
pub enum TransportError {
    #[error("transport_io: {0}")]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Frame(#[from] FrameError),
    #[error(transparent)]
    Codec(#[from] CodecError),
    /// The session host answered `rejected` with this code.
    #[error("handshake_rejected: {0}")]
    Rejected(&'static str),
    #[error("handshake_unexpected_message")]
    UnexpectedMessage,
    #[error("connection_closed")]
    Closed,
    #[error("session_host_already_serving")]
    AlreadyServing,
    #[error("connection_token_unavailable")]
    TokenUnavailable,
    #[error("connection_token_malformed")]
    TokenMalformed,
    #[error("identity_invalid")]
    IdentityInvalid,
}
