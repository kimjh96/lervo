//! The session host's local transport (session-host protocol, "Transport" and "Handshake").
//!
//! The transport is one external boundary: the socket, the connection token on disk, and the
//! frames that cross the socket. Session behavior lives in the domain and the host binary.

pub mod client;
pub mod error;
pub mod framed;
pub mod handshake;
pub mod paths;
#[cfg(unix)]
pub mod socket;
pub mod token;

pub use error::TransportError;
