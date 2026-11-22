//! What the session host knows about its sessions: the registry of handles, and the latest status
//! of each session for the connections that watch them all.

use std::collections::HashMap;

use lervo_session_protocol::{HostMessage, Identifier};
use tokio::sync::mpsc;

use crate::session::{MAX_RETAINED_ENDED, SessionHandle};
use crate::subscriber::Outgoing;

/// Sessions by identifier, the session of each terminal channel, and each workspace's session.
#[derive(Default)]
pub struct Registry {
    pub sessions: HashMap<Identifier, SessionHandle>,
    pub channels: HashMap<u32, Identifier>,
    /// The latest session of each workspace.
    pub workspaces: HashMap<Identifier, Identifier>,
}

impl Registry {
    /// Releases the oldest ended sessions beyond `MAX_RETAINED_ENDED`. Channels only grow, so the
    /// lowest channels belong to the oldest sessions.
    pub fn release_oldest_ended(&self) {
        let mut ended: Vec<&SessionHandle> = self
            .sessions
            .values()
            .filter(|handle| !handle.is_running() && !handle.is_gone())
            .collect();
        if ended.len() <= MAX_RETAINED_ENDED {
            return;
        }
        ended.sort_by_key(|handle| handle.channel);
        for handle in &ended[..ended.len() - MAX_RETAINED_ENDED] {
            handle.release();
        }
    }

    /// Forgets sessions whose actor exited, so the registry stays as large as the live sessions.
    pub fn prune(&mut self) {
        self.sessions.retain(|_, handle| !handle.is_gone());
        let sessions = &self.sessions;
        self.channels
            .retain(|_, session| sessions.contains_key(session));
    }
}

/// The latest status of each session, and the connections that watch every session.
#[derive(Default)]
pub struct Watch {
    pub statuses: HashMap<Identifier, HostMessage>,
    pub connections: Vec<(u64, mpsc::UnboundedSender<Outgoing>)>,
}

impl Watch {
    pub fn record(&mut self, message: HostMessage) {
        let HostMessage::SessionStatusMessage(status) = &message else {
            return;
        };
        self.statuses
            .insert(status.session_id.clone(), message.clone());
        self.connections
            .retain(|(_, outgoing)| outgoing.send(control(message.clone())).is_ok());
    }
}

pub fn control(message: HostMessage) -> Outgoing {
    Outgoing::Control {
        message,
        budget: None,
    }
}
