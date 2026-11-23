//! What a connection writes to its client, and the budgets that bound it (ADE performance,
//! "Everything is bounded"). Control messages are encoded when they are queued, so each counts
//! its exact size.

use crate::diagnostics::{Diagnostics, Field};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use lervo_session_core::budget::{Admission, ClientBudget};
use lervo_session_protocol::codec::encode;
use lervo_session_protocol::{HostMessage, Identifier};
use tokio::sync::mpsc;

use crate::messages;

/// Bytes of replies and watched statuses a client may have queued before its connection closes.
/// A reply cannot be dropped like a terminal frame, so a client this far behind reconnects.
pub(crate) const REPLY_BUFFER_LIMIT: usize = 16 * 1024 * 1024;

type Budget = Arc<Mutex<ClientBudget>>;

/// What a connection writes to its client.
#[derive(Debug)]
pub(crate) enum Outgoing {
    Control {
        payload: Arc<[u8]>,
        budget: Budget,
    },
    Terminal {
        channel: u32,
        sequence: u64,
        bytes: Arc<[u8]>,
        budget: Budget,
    },
}

impl Outgoing {
    /// Releases this item's bytes from its budget after the transport wrote it.
    pub(crate) fn release(&self) {
        let (budget, bytes) = match self {
            Self::Control { payload, budget } => (budget, payload.len()),
            Self::Terminal { budget, bytes, .. } => (budget, bytes.len()),
        };
        if let Ok(mut budget) = budget.lock() {
            budget.release(bytes);
        }
    }
}

/// One connection's queue to its client, with the budget for replies and watched statuses.
#[derive(Clone)]
pub(crate) struct Output {
    pub(crate) connection: u64,
    sender: mpsc::UnboundedSender<Outgoing>,
    budget: Budget,
    overflowed: Arc<AtomicBool>,
    diagnostics: Diagnostics,
}

impl Output {
    pub(crate) fn new(connection: u64, sender: mpsc::UnboundedSender<Outgoing>) -> Self {
        Self {
            connection,
            sender,
            budget: Arc::new(Mutex::new(ClientBudget::new(REPLY_BUFFER_LIMIT))),
            overflowed: Arc::new(AtomicBool::new(false)),
            diagnostics: Diagnostics::disabled(),
        }
    }

    /// The same output, recording each failed request it carries in `diagnostics`.
    pub(crate) fn with_diagnostics(mut self, diagnostics: Diagnostics) -> Self {
        self.diagnostics = diagnostics;
        self
    }

    /// Queues a reply or a watched status. Returns `false` when the connection is gone or fell
    /// so far behind that it must close.
    pub(crate) fn send(&self, message: &HostMessage) -> bool {
        if let HostMessage::RequestFailedMessage(failed) = message {
            let code = serde_json::to_value(failed.code).unwrap_or_default();
            self.diagnostics.record(
                "request.failed",
                &[
                    ("connection", Field::Number(self.connection)),
                    ("code", Field::Code(code.as_str().unwrap_or("unknown"))),
                ],
            );
        }
        let Some(payload) = encoded(message) else {
            return !self.sender.is_closed();
        };
        let admission = self
            .budget
            .lock()
            .map_or(Admission::Drop, |mut budget| budget.admit(payload.len()));
        if admission != Admission::Queue {
            self.overflowed.store(true, Ordering::Release);
            return false;
        }
        let budget = Arc::clone(&self.budget);
        self.sender
            .send(Outgoing::Control { payload, budget })
            .is_ok()
    }

    /// Whether the connection fell too far behind and must close.
    pub(crate) fn overflowed(&self) -> bool {
        self.overflowed.load(Ordering::Acquire)
    }

    pub(crate) fn is_closed(&self) -> bool {
        self.sender.is_closed() || self.overflowed()
    }
}

/// One client's subscription to a session, with its own budget for that session's updates.
pub(crate) struct Subscriber {
    output: Output,
    budget: Budget,
}

impl Subscriber {
    pub(crate) fn new(output: Output) -> Self {
        Self {
            output,
            budget: Arc::new(Mutex::new(ClientBudget::default())),
        }
    }

    pub(crate) fn connection(&self) -> u64 {
        self.output.connection
    }

    /// Queues an item. Returns `false` when the connection is gone. A client that falls behind
    /// receives `session.resync_required` once and nothing more until it attaches again.
    fn deliver(&mut self, session: &Identifier, item: Outgoing, bytes: usize) -> bool {
        let admission = self
            .budget
            .lock()
            .map_or(Admission::Drop, |mut budget| budget.admit(bytes));
        match admission {
            Admission::Queue => self.output.sender.send(item).is_ok(),
            Admission::Resync => self.output.send(&messages::resync_required(session)),
            Admission::Drop => !self.output.is_closed(),
        }
    }

    pub(crate) fn control(&mut self, session: &Identifier, message: &HostMessage) -> bool {
        match encoded(message) {
            Some(payload) => self.control_payload(session, &payload),
            None => !self.output.is_closed(),
        }
    }

    /// Queues a control message encoded once for every subscriber of a broadcast.
    pub(crate) fn control_payload(&mut self, session: &Identifier, payload: &Arc<[u8]>) -> bool {
        let item = Outgoing::Control {
            payload: Arc::clone(payload),
            budget: Arc::clone(&self.budget),
        };
        self.deliver(session, item, payload.len())
    }

    pub(crate) fn terminal(
        &mut self,
        session: &Identifier,
        channel: u32,
        sequence: u64,
        bytes: &Arc<[u8]>,
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

/// A host message encoded for the wire. Encoding fails only for a message the session host built
/// wrong, which is then not sent.
pub(crate) fn encoded(message: &HostMessage) -> Option<Arc<[u8]>> {
    encode(message).ok().map(Arc::from)
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU64;
    use std::sync::Arc;

    use lervo_session_core::budget::CLIENT_BUFFER_LIMIT;
    use lervo_session_protocol::codec::MessageCodec;
    use lervo_session_protocol::{HostMessage, Identifier};
    use tokio::sync::mpsc;

    use super::{Outgoing, Output, REPLY_BUFFER_LIMIT, Subscriber};
    use crate::messages;

    fn session() -> Identifier {
        Identifier::try_from("ses_1").unwrap()
    }

    #[test]
    fn asks_a_client_that_falls_behind_to_resync_once() {
        let codec = MessageCodec::new().unwrap();
        let (sender, mut queue) = mpsc::unbounded_channel();
        let mut subscriber = Subscriber::new(Output::new(1, sender));
        let chunk: Arc<[u8]> = Arc::from(vec![0_u8; CLIENT_BUFFER_LIMIT / 2]);
        for sequence in 1..=5 {
            assert!(subscriber.terminal(&session(), 1, sequence, &chunk));
        }
        let mut kinds = Vec::new();
        while let Ok(item) = queue.try_recv() {
            kinds.push(match item {
                Outgoing::Terminal { sequence, .. } => format!("terminal {sequence}"),
                Outgoing::Control { payload, .. } => match codec.decode_host(&payload).unwrap() {
                    HostMessage::SessionResyncRequiredMessage(_) => "resync".to_owned(),
                    _ => "other".to_owned(),
                },
            });
        }
        assert_eq!(kinds, ["terminal 1", "terminal 2", "resync"]);
    }

    #[test]
    fn releases_written_bytes_back_to_the_budget() {
        let (sender, mut queue) = mpsc::unbounded_channel();
        let mut subscriber = Subscriber::new(Output::new(1, sender));
        let chunk: Arc<[u8]> = Arc::from(vec![0_u8; CLIENT_BUFFER_LIMIT / 2]);
        for sequence in 1..=6 {
            assert!(subscriber.terminal(&session(), 1, sequence, &chunk));
            queue.try_recv().unwrap().release();
        }
    }

    #[test]
    fn closes_a_connection_whose_replies_exceed_their_budget() {
        let (sender, _queue) = mpsc::unbounded_channel();
        let output = Output::new(1, sender);
        let text = "x".repeat(60 * 1024);
        let mut sent = 0;
        let delta = messages::delta(&session(), NonZeroU64::MIN, "i1", &text).unwrap();
        while output.send(&delta) {
            sent += text.len();
            assert!(sent <= REPLY_BUFFER_LIMIT);
        }
        assert!(output.overflowed());
        assert!(output.is_closed());
    }
}
