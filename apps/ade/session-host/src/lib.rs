//! The Lervo session host (ADR-0613): it owns PTYs and provider processes, outlives the
//! interface, and speaks the session-host protocol over an owner-only local socket.

pub mod arguments;
mod connection;
mod host;
mod items;
mod messages;
mod native;
pub mod paths;
pub mod ports;
pub mod serve;
mod session;
mod subscriber;
mod terminal;
