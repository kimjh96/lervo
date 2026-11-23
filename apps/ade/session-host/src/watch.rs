//! The connections that watch every session's status (`sessions.watch`). One task owns the latest
//! status of each session and the watching connections, so they have a single writer (ADE
//! convention, "Encapsulation"); everything else sends it events.

use std::collections::{HashMap, HashSet};

use lervo_session_protocol::{HostMessage, Identifier};
use tokio::sync::mpsc;

use crate::subscriber::Output;

enum Event {
    /// A session's status changed.
    Status(HostMessage),
    /// A connection watches every session from now on.
    Watch(Output),
    /// A connection closed.
    Unwatch(u64),
    /// Only these sessions still exist; the others' statuses are forgotten.
    Retain(HashSet<Identifier>),
}

/// Sends events to the watch task. Each status change is one event, so the queue stays as small
/// as the rate of status changes.
#[derive(Clone)]
pub(crate) struct WatchSender(mpsc::UnboundedSender<Event>);

impl WatchSender {
    pub(crate) fn status(&self, message: HostMessage) {
        let _ = self.0.send(Event::Status(message));
    }

    /// Sends `output` every session's latest status, then every change.
    pub(crate) fn watch(&self, output: Output) {
        let _ = self.0.send(Event::Watch(output));
    }

    pub(crate) fn unwatch(&self, connection: u64) {
        let _ = self.0.send(Event::Unwatch(connection));
    }

    pub(crate) fn retain(&self, sessions: HashSet<Identifier>) {
        let _ = self.0.send(Event::Retain(sessions));
    }
}

/// Starts the watch task. It ends when every sender is gone.
pub(crate) fn spawn() -> WatchSender {
    let (sender, mut events) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        let mut watch = Watch::default();
        while let Some(event) = events.recv().await {
            watch.apply(event);
        }
    });
    WatchSender(sender)
}

#[derive(Default)]
struct Watch {
    statuses: HashMap<Identifier, HostMessage>,
    connections: Vec<Output>,
}

impl Watch {
    fn apply(&mut self, event: Event) {
        match event {
            Event::Status(message) => {
                let HostMessage::SessionStatusMessage(status) = &message else {
                    return;
                };
                self.statuses
                    .insert(status.session_id.clone(), message.clone());
                self.connections.retain(|output| output.send(&message));
            }
            Event::Watch(output) => {
                self.connections
                    .retain(|watching| watching.connection != output.connection);
                if self.statuses.values().all(|message| output.send(message)) {
                    self.connections.push(output);
                }
            }
            Event::Unwatch(connection) => self
                .connections
                .retain(|output| output.connection != connection),
            Event::Retain(sessions) => self
                .statuses
                .retain(|session, _| sessions.contains(session)),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::num::NonZeroU64;

    use lervo_session_core::status::SessionStatus;
    use lervo_session_protocol::Identifier;
    use lervo_session_protocol::codec::MessageCodec;
    use tokio::sync::mpsc;

    use super::{Event, Watch};
    use crate::messages;
    use crate::subscriber::{Outgoing, Output};

    fn status(session: &str, value: SessionStatus) -> Event {
        let session = Identifier::try_from(session).unwrap();
        Event::Status(messages::status(&session, NonZeroU64::MIN, value))
    }

    #[test]
    fn gives_a_new_watcher_the_latest_statuses_of_live_sessions_then_changes() {
        let codec = MessageCodec::new().unwrap();
        let mut watch = Watch::default();
        watch.apply(status("ses_1", SessionStatus::Working));
        watch.apply(status("ses_2", SessionStatus::Idle));
        watch.apply(Event::Retain(HashSet::from([Identifier::try_from(
            "ses_1",
        )
        .unwrap()])));
        let (sender, mut queue) = mpsc::unbounded_channel();
        watch.apply(Event::Watch(Output::new(7, sender)));
        watch.apply(status("ses_1", SessionStatus::NeedsUser));
        let mut seen = Vec::new();
        while let Ok(Outgoing::Control { payload, .. }) = queue.try_recv() {
            seen.push(format!("{:?}", codec.decode_host(&payload).unwrap()));
        }
        assert_eq!(seen.len(), 2);
        assert!(seen.iter().all(|message| message.contains("ses_1")));
        watch.apply(Event::Unwatch(7));
        assert!(watch.connections.is_empty());
    }
}
