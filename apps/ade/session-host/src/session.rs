//! What every session actor shares: its commands, its handle, and the fan-out of sequenced
//! updates to subscribers. Each actor alone owns its session's state, so no lock guards it (ADE
//! convention, "Encapsulation").

use std::num::NonZeroU64;
use std::sync::Arc;
use std::time::Duration;

use lervo_session_core::paging::Direction;
use lervo_session_core::sequence::SequenceCounter;
use lervo_session_core::status::{SessionEvent, SessionStatus};
use lervo_session_protocol::{HostMessage, Identifier};
use tokio::sync::{mpsc, watch};

use crate::messages;
use crate::subscriber::{Output, Subscriber, encoded};
use lervo_session_core::ports::{ConversationMode, SentImage};
use lervo_session_core::transcript::NoticeValue;
use std::collections::BTreeMap;

/// How long an ended session still answers attaches and ranges before its actor exits. After
/// that, `session.open` starts the session again.
pub(crate) const ENDED_RETENTION: Duration = Duration::from_secs(10 * 60);
/// Ended sessions retained at once; opening a session releases the oldest beyond this.
pub(crate) const MAX_RETAINED_ENDED: usize = 32;
const COMMAND_QUEUE: usize = 64;

/// Where a session reports each status change for connections that watch every session.
pub(crate) type StatusSink = crate::watch::WatchSender;

/// Where a request's answer goes: the requesting connection, within its reply budget.
pub(crate) struct Reply(Output);

impl Reply {
    pub(crate) fn new(output: &Output) -> Self {
        Self(output.clone())
    }

    /// Queues the answer. A connection that is gone or too far behind has closed, and its client
    /// fails the request when it reconnects.
    pub(crate) fn send(&self, message: HostMessage) {
        let _ = self.0.send(&message);
    }
}

/// A request for a page of conversation items.
pub(crate) struct Range {
    pub request: Identifier,
    pub anchor: Option<String>,
    pub direction: Direction,
    pub limit: u64,
    pub reply: Reply,
}

/// Commands a session accepts. Each actor answers the commands its conversation mode supports.
pub(crate) enum Command {
    Attach {
        after_sequence: u64,
        subscriber: Subscriber,
    },
    Detach {
        connection: u64,
    },
    Input(Vec<u8>),
    Resize {
        columns: u16,
        rows: u16,
    },
    Send {
        request: Identifier,
        text: String,
        /// The images the message carries, as the protocol checked them.
        images: Vec<SentImage>,
        reply: Reply,
    },
    /// Stops the native conversation's running turn and keeps the session.
    Interrupt {
        request: Identifier,
        reply: Reply,
    },
    /// Answers the agent's question with choices (Lervo ADE sessions, "Questions").
    Answer {
        request: Identifier,
        /// The question's `choices.requestId`.
        question: String,
        answers: BTreeMap<String, String>,
        reply: Reply,
    },
    Range(Range),
    Stop,
    /// Ends an ended session's retention early, so its actor exits and its memory returns.
    Release,
    /// Gives the session a turn another agent's mention delivered, after its running turn
    /// (Lervo ADE rooms).
    Deliver {
        delivery_id: String,
        text: String,
    },
    /// Shows a line of what the conversation's room did, such as a delivery that failed.
    Notice {
        code: String,
        parameters: BTreeMap<String, NoticeValue>,
    },
}

/// A handle that sends commands to a session's actor.
#[derive(Clone)]
pub(crate) struct SessionHandle {
    pub(crate) mode: ConversationMode,
    /// The terminal channel `session.opened` assigned. Native sessions do not use it.
    pub(crate) channel: u32,
    commands: mpsc::Sender<Command>,
    /// Becomes `true` when the provider process ended; the actor alone writes it.
    ended: watch::Receiver<bool>,
}

impl SessionHandle {
    /// A handle, the receiving end its actor reads, and the sender that reports the end.
    pub(crate) fn new(
        mode: ConversationMode,
        channel: u32,
    ) -> (Self, mpsc::Receiver<Command>, watch::Sender<bool>) {
        let (commands, receiver) = mpsc::channel(COMMAND_QUEUE);
        let (ended_sender, ended) = watch::channel(false);
        let handle = Self {
            mode,
            channel,
            commands,
            ended,
        };
        (handle, receiver, ended_sender)
    }

    /// Sends a command. Returns `false` once the actor is gone.
    pub(crate) async fn send(&self, command: Command) -> bool {
        self.commands.send(command).await.is_ok()
    }

    /// Ends an ended session's retention. A lingering actor reads its queue at once, so a full
    /// queue only delays the release to the next `session.open`.
    pub(crate) fn release(&self) {
        let _ = self.commands.try_send(Command::Release);
    }

    /// Whether the provider process still runs.
    pub(crate) fn is_running(&self) -> bool {
        !*self.ended.borrow() && !self.commands.is_closed()
    }

    /// Whether the actor exited.
    pub(crate) fn is_gone(&self) -> bool {
        self.commands.is_closed()
    }

    /// Waits until the provider process ended, at most `deadline`. Returns whether it ended.
    pub(crate) async fn ended_within(&self, deadline: Duration) -> bool {
        let mut ended = self.ended.clone();
        let wait = ended.wait_for(|ended| *ended);
        // A dropped sender means the actor exited, so the process ended too.
        tokio::time::timeout(deadline, wait).await.is_ok()
    }
}

/// A session's status, its one sequence counter, and its subscribers.
pub(crate) struct Fanout {
    session: Identifier,
    status: SessionStatus,
    /// The sequence at which the status last changed.
    status_at: u64,
    sequences: SequenceCounter,
    subscribers: Vec<Subscriber>,
    ended: watch::Sender<bool>,
    watchers: StatusSink,
}

impl Fanout {
    pub(crate) fn new(
        session: Identifier,
        ended: watch::Sender<bool>,
        watchers: StatusSink,
    ) -> Self {
        Self {
            session,
            status: SessionStatus::Starting,
            status_at: 0,
            sequences: SequenceCounter::new(),
            subscribers: Vec::new(),
            ended,
            watchers,
        }
    }

    pub(crate) fn session(&self) -> &Identifier {
        &self.session
    }

    /// The next sequence for a message that changes state.
    pub(crate) fn next_sequence(&mut self) -> NonZeroU64 {
        self.sequences.advance()
    }

    /// The last sequence sent, for messages that repeat state to one subscriber.
    pub(crate) fn last_sequence(&self) -> NonZeroU64 {
        NonZeroU64::new(self.sequences.last()).unwrap_or(NonZeroU64::MIN)
    }

    /// Applies `event` and reports the new status. An out-of-order event keeps the status.
    pub(crate) fn change(&mut self, event: SessionEvent) {
        let Ok(next) = self.status.apply(event) else {
            return;
        };
        self.status = next;
        self.status_at = self.sequences.advance().get();
        if next.is_ended() {
            self.ended.send_replace(true);
        }
        let message = self.status_message();
        self.watchers.status(message.clone());
        self.broadcast(&message);
    }

    /// Sends `message` to every subscriber, encoded once, and drops those whose connection is
    /// gone.
    pub(crate) fn broadcast(&mut self, message: &HostMessage) {
        let Some(payload) = encoded(message) else {
            return;
        };
        let session = &self.session;
        self.subscribers
            .retain_mut(|subscriber| subscriber.control_payload(session, &payload));
    }

    /// Sends terminal bytes to every subscriber.
    pub(crate) fn terminal(&mut self, channel: u32, sequence: u64, bytes: &Arc<[u8]>) {
        let session = &self.session;
        self.subscribers
            .retain_mut(|subscriber| subscriber.terminal(session, channel, sequence, bytes));
    }

    /// Adds `subscriber` after its replay, ending the catch-up with the current status.
    pub(crate) fn subscribe(&mut self, mut subscriber: Subscriber, replayed: bool) {
        self.detach(subscriber.connection());
        let alive = replayed && subscriber.control(&self.session, &self.status_message());
        if alive {
            self.subscribers.push(subscriber);
        }
    }

    /// Whether a client shows the session now, its conversation or its terminal.
    pub(crate) fn attended(&self) -> bool {
        !self.subscribers.is_empty()
    }

    /// Whether the agent waits for the person, as a question does.
    pub(crate) fn needs_user(&self) -> bool {
        self.status == SessionStatus::NeedsUser
    }

    pub(crate) fn detach(&mut self, connection: u64) {
        self.subscribers
            .retain(|subscriber| subscriber.connection() != connection);
    }

    fn status_message(&self) -> HostMessage {
        let sequence = NonZeroU64::new(self.status_at).unwrap_or(NonZeroU64::MIN);
        messages::status(&self.session, sequence, self.status)
    }
}

/// Serves commands after the session ended, until `ENDED_RETENTION` passes or every handle drops.
pub(crate) async fn linger(commands: &mut mpsc::Receiver<Command>, mut serve: impl FnMut(Command)) {
    let deadline = tokio::time::sleep(ENDED_RETENTION);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            command = commands.recv() => match command {
                Some(Command::Release) | None => return,
                Some(command) => serve(command),
            },
            () = &mut deadline => return,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::SessionHandle;
    use lervo_session_core::ports::ConversationMode;

    #[tokio::test]
    async fn waits_for_the_end_of_the_process_within_a_deadline() {
        let (handle, _commands, ended) = SessionHandle::new(ConversationMode::Cli, 1);
        assert!(!handle.ended_within(Duration::from_millis(20)).await);
        assert!(handle.is_running());
        ended.send_replace(true);
        assert!(handle.ended_within(Duration::from_millis(20)).await);
        assert!(!handle.is_running());
    }

    #[tokio::test]
    async fn counts_an_actor_that_exited_as_ended() {
        let (handle, commands, ended) = SessionHandle::new(ConversationMode::Cli, 1);
        drop((commands, ended));
        assert!(handle.ended_within(Duration::from_millis(20)).await);
        assert!(handle.is_gone());
    }
}
