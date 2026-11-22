//! The `serve` command: one session host per OS user.

use std::fs::{self, OpenOptions};
use std::future::Future;
use std::sync::Arc;

use lervo_session_protocol::codec::MessageCodec;
use lervo_session_transport::TransportError;
use lervo_session_transport::handshake::HostIdentity;
use lervo_session_transport::socket::bind;
use lervo_session_transport::token::{self, Token, create_private_directory};

use crate::connection;
use crate::host::Host;
use lervo_session_core::ports::Core;
use lervo_session_transport::paths::Layout;

/// Why the session host could not serve.
#[derive(Debug, thiserror::Error)]
pub enum ServeError {
    /// Another session host holds the lock. This is not a failure for the caller.
    #[error("session_host_already_running")]
    AlreadyRunning,
    #[error(transparent)]
    Transport(#[from] TransportError),
    #[error("session_host_io: {0}")]
    Io(#[from] std::io::Error),
}

/// Serves until `shutdown` completes. Holds the lock, writes a new token, and binds the socket;
/// on shutdown it removes the socket and the token. Sessions end with the session host.
pub async fn run<C: Core>(
    layout: &Layout,
    core: C,
    identity: HostIdentity,
    shutdown: impl Future<Output = ()>,
) -> Result<(), ServeError> {
    create_private_directory(&layout.root)?;
    let lock_file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&layout.lock)?;
    let mut lock = fd_lock::RwLock::new(lock_file);
    let _held = lock.try_write().map_err(|_| ServeError::AlreadyRunning)?;

    let connection_token = Token::generate()?;
    token::write(&layout.token, &connection_token)?;
    let listener = bind(&layout.socket).await?;
    let codec = MessageCodec::new().map_err(TransportError::from)?;
    std::fs::create_dir_all(&layout.indexes)?;
    let host = Arc::new(Host::new(
        core,
        codec,
        connection_token,
        identity,
        layout.indexes.clone(),
    ));

    tokio::pin!(shutdown);
    let mut next_connection = 0_u64;
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let Ok((stream, _)) = accepted else { continue };
                next_connection += 1;
                let (read, write) = stream.into_split();
                let host = Arc::clone(&host);
                let connection = next_connection;
                tokio::spawn(async move {
                    let _ = connection::serve(host, connection, read, write).await;
                });
            }
            () = &mut shutdown => break,
        }
    }
    let _ = fs::remove_file(&layout.socket);
    let _ = fs::remove_file(&layout.token);
    Ok(())
}
