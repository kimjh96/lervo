//! The ADE session-host protocol (ADE session-host protocol specification).
//!
//! The message types are generated at build time from the JSON Schema document that
//! `@lervo/session-host-contract` exports, so the Rust and TypeScript sides share one contract.

#[allow(clippy::all, clippy::unwrap_used, clippy::expect_used, missing_docs)]
mod generated {
    include!(concat!(env!("OUT_DIR"), "/protocol.rs"));
}

pub mod codec;
pub mod frame;

pub use generated::*;
