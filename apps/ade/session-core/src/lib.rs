//! The session host's domain (ADE convention, "Layers"). Nothing here performs I/O: processes,
//! files, sockets, and clocks enter through the adapters that use these types.

pub mod budget;
pub mod cache;
pub mod content;
pub mod paging;
pub mod ports;
pub mod retention;
pub mod scrollback;
pub mod sequence;
pub mod status;
pub mod transcript;
