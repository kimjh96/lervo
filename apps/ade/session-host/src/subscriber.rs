//! One client's subscription to a session, and the items a connection writes to its client.

use std::sync::{Arc, Mutex};

use lervo_session_core::budget::{Admission, ClientBudget};
use lervo_session_protocol::{HostMessage, Identifier};
use tokio::sync::mpsc;

use crate::messages;

/// Bytes counted for one control message against a client's budget.
const CONTROL_MESSAGE_BYTES: usize = 512;

/// What a connection writes to its client.
#[derive(Debug)]
pub enum Outgoing {
    Control {
        message: HostMessage,
        budget: Option<Arc<Mutex<ClientBudget>>>,
    },
    Terminal {
        channel: u32,
        sequence: u64,
        bytes: Arc<Vec<u8>>,
        budget: Arc<Mutex<ClientBudget>>,
    },
}

impl Outgoing {
    /// Releases this item's bytes from its client budget after the transport wrote it.
    pub fn release(&self) {
        let (budget, bytes) = match self {
            Self::Control {
                budget: Some(budget),
                ..
            } => (budget, CONTROL_MESSAGE_BYTES),
            Self::Terminal { budget, bytes, .. } => (budget, bytes.len()),
            Self::Control { budget: None, .. } => return,
        };
        if let Ok(mut budget) = budget.lock() {
            budget.release(bytes);
        }
    }
}

/// One client's subscription to a session.
pub struct Subscriber {
    pub connection: u64,
    pub outgoing: mpsc::UnboundedSender<Outgoing>,
    budget: Arc<Mutex<ClientBudget>>,
}

impl Subscriber {
    pub fn new(connection: u64, outgoing: mpsc::UnboundedSender<Outgoing>) -> Self {
        Self {
            connection,
            outgoing,
            budget: Arc::new(Mutex::new(ClientBudget::default())),
        }
    }

    /// Queues an item. Returns `false` when the connection is gone. A client that falls behind
    /// receives `session.resync_required` once and nothing more until it attaches again.
    fn deliver(&mut self, session: &Identifier, item: Outgoing, bytes: usize) -> bool {
        let admission = self
            .budget
            .lock()
            .map_or(Admission::Drop, |mut budget| budget.admit(bytes));
        match admission {
            Admission::Queue => self.outgoing.send(item).is_ok(),
            Admission::Resync => {
                let resync = Outgoing::Control {
                    message: messages::resync_required(session),
                    budget: None,
                };
                self.outgoing.send(resync).is_ok()
            }
            Admission::Drop => !self.outgoing.is_closed(),
        }
    }

    pub(crate) fn control(&mut self, session: &Identifier, message: HostMessage) -> bool {
        let item = Outgoing::Control {
            message,
            budget: Some(Arc::clone(&self.budget)),
        };
        self.deliver(session, item, CONTROL_MESSAGE_BYTES)
    }

    pub(crate) fn terminal(
        &mut self,
        session: &Identifier,
        channel: u32,
        sequence: u64,
        bytes: &Arc<Vec<u8>>,
    ) -> bool {
        let item = Outgoing::Terminal {
            channel,
            sequence,
            bytes: Arc::clone(bytes),
            budget: Arc::clone(&self.budget),
        };
        self.deliver(session, item, bytes.len())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use lervo_session_core::budget::CLIENT_BUFFER_LIMIT;
    use lervo_session_protocol::{HostMessage, Identifier};
    use tokio::sync::mpsc;

    use super::{Outgoing, Subscriber};

    #[test]
    fn asks_a_client_that_falls_behind_to_resync_once() {
        let session = Identifier::try_from("ses_1").unwrap();
        let (sender, mut queue) = mpsc::unbounded_channel();
        let mut subscriber = Subscriber::new(1, sender);
        let chunk = Arc::new(vec![0_u8; CLIENT_BUFFER_LIMIT / 2]);
        for sequence in 1..=5 {
            assert!(subscriber.terminal(&session, 1, sequence, &chunk));
        }
        let mut kinds = Vec::new();
        while let Ok(item) = queue.try_recv() {
            kinds.push(match item {
                Outgoing::Terminal { sequence, .. } => format!("terminal {sequence}"),
                Outgoing::Control {
                    message: HostMessage::SessionResyncRequiredMessage(_),
                    ..
                } => "resync".to_owned(),
                Outgoing::Control { .. } => "other".to_owned(),
            });
        }
        assert_eq!(kinds, ["terminal 1", "terminal 2", "resync"]);
    }

    #[test]
    fn releases_written_bytes_back_to_the_budget() {
        let session = Identifier::try_from("ses_1").unwrap();
        let (sender, mut queue) = mpsc::unbounded_channel();
        let mut subscriber = Subscriber::new(1, sender);
        let chunk = Arc::new(vec![0_u8; CLIENT_BUFFER_LIMIT / 2]);
        for sequence in 1..=6 {
            assert!(subscriber.terminal(&session, 1, sequence, &chunk));
            queue.try_recv().unwrap().release();
        }
    }
}
