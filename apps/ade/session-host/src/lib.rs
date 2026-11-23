//! The Lervo session host (ADR-0613): it owns PTYs and provider processes, outlives the
//! interface, and speaks the session-host protocol over an owner-only local socket.

pub mod arguments;
mod connection;
mod dispatch;
mod host;
mod index;
mod items;
mod lifecycle;
mod messages;
mod native;
mod rebuild;
mod registry;
pub mod serve;
mod session;
mod subscriber;
mod terminal;
mod watch;

/// Where the session host keeps its state, shared with its clients.
pub use lervo_session_transport::paths;
