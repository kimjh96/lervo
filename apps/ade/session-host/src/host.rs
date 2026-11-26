//! The running session host: its core port, identity, token, registry, and the watch of every
//! session's status. `dispatch` handles client messages, and `lifecycle` starts and switches
//! sessions.

use std::path::PathBuf;
use std::sync::atomic::AtomicU32;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use lervo_session_protocol::codec::MessageCodec;
use lervo_session_transport::handshake::HostIdentity;
use lervo_session_transport::token::Token;

use crate::diagnostics::Diagnostics;
use crate::registry::Registry;
use crate::watch::{self, WatchSender};
use lervo_session_core::ports::{Core, RoomDelivery};
use tokio::sync::mpsc;

pub(crate) struct Host<C> {
    /// Shared, so an ended session can report its exit after the request that started it.
    pub(crate) core: Arc<C>,
    pub(crate) codec: MessageCodec,
    pub(crate) token: Token,
    pub(crate) identity: HostIdentity,
    pub(crate) indexes: PathBuf,
    pub(crate) diagnostics: Diagnostics,
    registry: Mutex<Registry>,
    pub(crate) watch: WatchSender,
    /// Serializes session starts and mode switches, which wait on I/O; the registry's lock is
    /// never held across a wait, so other clients' messages flow meanwhile.
    pub(crate) lifecycle: tokio::sync::Mutex<()>,
    pub(crate) next_channel: AtomicU32,
    /// Where native sessions send the turns their mentions set off (Lervo ADE rooms).
    pub(crate) deliveries: mpsc::UnboundedSender<RoomDelivery>,
    /// The other end, which `serve` hands to the delivery worker once.
    delivered: Mutex<Option<mpsc::UnboundedReceiver<RoomDelivery>>>,
}

impl<C: Core> Host<C> {
    pub(crate) fn new(
        core: C,
        codec: MessageCodec,
        token: Token,
        identity: HostIdentity,
        indexes: PathBuf,
        diagnostics: Diagnostics,
    ) -> Self {
        let (deliveries, delivered) = mpsc::unbounded_channel();
        Self {
            core: Arc::new(core),
            codec,
            token,
            identity,
            indexes,
            diagnostics,
            registry: Mutex::new(Registry::default()),
            watch: watch::spawn(),
            lifecycle: tokio::sync::Mutex::new(()),
            next_channel: AtomicU32::new(1),
            deliveries,
            delivered: Mutex::new(Some(delivered)),
        }
    }

    /// The deliveries native sessions send, for the worker that performs them; none after the
    /// first call.
    pub(crate) fn take_deliveries(&self) -> Option<mpsc::UnboundedReceiver<RoomDelivery>> {
        self.delivered
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
    }

    /// The registry, for a quick lookup or insert. Never hold it across an await.
    pub(crate) fn registry(&self) -> MutexGuard<'_, Registry> {
        self.registry.lock().unwrap_or_else(PoisonError::into_inner)
    }
}
