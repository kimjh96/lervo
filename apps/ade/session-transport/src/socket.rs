//! The owner-only Unix domain socket (session-host protocol, "Transport"). Clients and the session
//! host reach it only through this module, so another platform's transport, such as a Windows
//! named pipe, replaces this module and nothing else.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use tokio::net::{UnixListener, UnixStream};

use crate::TransportError;
use crate::token::create_private_directory;

/// A connected stream to the session host.
pub type Stream = UnixStream;

/// Connects to the session host's socket at `path`.
pub async fn connect(path: &Path) -> Result<Stream, TransportError> {
    Ok(UnixStream::connect(path).await?)
}

/// Binds the socket at `path` inside an owner-only directory. A leftover socket file from a host
/// that is no longer running is replaced; a live host makes this fail with `AlreadyServing`.
pub async fn bind(path: &Path) -> Result<UnixListener, TransportError> {
    if let Some(directory) = path.parent() {
        create_private_directory(directory)?;
    }
    if fs::symlink_metadata(path).is_ok() {
        if UnixStream::connect(path).await.is_ok() {
            return Err(TransportError::AlreadyServing);
        }
        fs::remove_file(path)?;
    }
    let listener = UnixListener::bind(path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(listener)
}
