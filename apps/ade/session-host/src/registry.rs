//! The registry of session handles: sessions by identifier, the session of each terminal channel,
//! and each workspace's latest session. Only the lifecycle changes it, and it holds the registry's
//! lock only for these quick lookups and inserts, never across I/O.

use std::collections::{HashMap, HashSet};

use lervo_session_protocol::Identifier;

use crate::session::{MAX_RETAINED_ENDED, SessionHandle};

#[derive(Default)]
pub(crate) struct Registry {
    pub(crate) sessions: HashMap<Identifier, SessionHandle>,
    pub(crate) channels: HashMap<u32, Identifier>,
    /// The latest session of each workspace.
    pub(crate) workspaces: HashMap<Identifier, Identifier>,
}

impl Registry {
    /// Releases the oldest ended sessions beyond `MAX_RETAINED_ENDED`. Channels only grow, so the
    /// lowest channels belong to the oldest sessions.
    pub(crate) fn release_oldest_ended(&self) {
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
    pub(crate) fn prune(&mut self) {
        self.sessions.retain(|_, handle| !handle.is_gone());
        let sessions = &self.sessions;
        self.channels
            .retain(|_, session| sessions.contains_key(session));
        self.workspaces
            .retain(|_, session| sessions.contains_key(session));
    }

    /// The sessions that still exist.
    pub(crate) fn live(&self) -> HashSet<Identifier> {
        self.sessions.keys().cloned().collect()
    }

    /// The workspace's session while its provider process runs.
    pub(crate) fn running(&self, workspace: &Identifier) -> Option<(Identifier, SessionHandle)> {
        let session = self.workspaces.get(workspace)?;
        let handle = self.sessions.get(session)?;
        handle
            .is_running()
            .then(|| (session.clone(), handle.clone()))
    }

    pub(crate) fn insert(
        &mut self,
        workspace: Identifier,
        session: Identifier,
        handle: SessionHandle,
    ) {
        self.channels.insert(handle.channel, session.clone());
        self.workspaces.insert(workspace, session.clone());
        self.sessions.insert(session, handle);
    }
}
