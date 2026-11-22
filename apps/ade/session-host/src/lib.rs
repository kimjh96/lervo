//! The Lervo session host (ADR-0613): it owns PTYs and provider processes, outlives the
//! interface, and speaks the session-host protocol over an owner-only local socket.

pub mod arguments;
mod connection;
mod host;
mod items;
mod messages;
mod native;
mod registry;
pub mod serve;
mod session;
mod subscriber;
mod terminal;

/// The ports to the Lervo core, which the domain defines.
pub use lervo_session_core::ports;

/// Where the session host keeps its state, shared with its clients.
pub use lervo_session_transport::paths;
