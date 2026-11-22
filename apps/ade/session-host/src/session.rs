//! What every session actor shares: its commands, its handle, and the fan-out of sequenced
//! updates to subscribers. Each actor alone owns its session's state, so no lock guards it (ADE
//! convention, "Encapsulation").

use std::num::NonZeroU64;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use lervo_session_core::paging::Direction;
use lervo_session_core::sequence::SequenceCounter;
use lervo_session_core::status::{SessionEvent, SessionStatus};
use lervo_session_protocol::{HostMessage, Identifier};
use tokio::sync::mpsc;

use crate::messages;
use crate::subscriber::{Outgoing, Subscriber};
use lervo_session_core::ports::ConversationMode;

/// How long an ended session still answers attaches and ranges before its actor exits. After
/// that, `session.open` starts the session again.
pub const ENDED_RETENTION: Duration = Duration::from_secs(10 * 60);
/// Ended sessions retained at once; opening a session releases the oldest beyond this.
pub const MAX_RETAINED_ENDED: usize = 32;
const COMMAND_QUEUE: usize = 64;

/// Where a session reports each status change for connections that watch every session.
pub type StatusSink = mpsc::UnboundedSender<HostMessage>;

/// Where a request's answer goes.
pub struct Reply(mpsc::UnboundedSender<Outgoing>);

impl Reply {
    pub fn new(outgoing: &mpsc::UnboundedSender<Outgoing>) -> Self {
        Self(outgoing.clone())
    }

    pub fn send(&self, message: HostMessage) {
        let _ = self.0.send(Outgoing::Control {
            message,
            budget: None,
        });
    }
}

/// A request for a page of conversation items.
pub struct Range {
    pub request: Identifier,
    pub anchor: Option<String>,
    pub direction: Direction,
    pub limit: u64,
    pub reply: Reply,
}

/// Commands a session accepts. Each actor answers the commands its conversation mode supports.
pub enum Command {
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
        reply: Reply,
    },
    Range(Range),
    Stop,
    /// Ends an ended session's retention early, so its actor exits and its memory returns.
    Release,
}

/// A handle that sends commands to a session's actor.
#[derive(Clone)]
pub struct SessionHandle {
    pub mode: ConversationMode,
    /// The terminal channel `session.opened` assigned. Native sessions do not use it.
    pub channel: u32,
    commands: mpsc::Sender<Command>,
    ended: Arc<AtomicBool>,
}

impl SessionHandle {
    /// A handle and the receiving end its actor reads.
    pub fn new(mode: ConversationMode, channel: u32) -> (Self, mpsc::Receiver<Command>) {
        let (commands, receiver) = mpsc::channel(COMMAND_QUEUE);
        let handle = Self {
            mode,
            channel,
            commands,
            ended: Arc::new(AtomicBool::new(false)),
        };
        (handle, receiver)
    }

    /// Sends a command. Returns `false` once the actor is gone.
    pub async fn send(&self, command: Command) -> bool {
        self.commands.send(command).await.is_ok()
    }

    /// Ends an ended session's retention. A lingering actor reads its queue at once, so a full
    /// queue only delays the release to the next `session.open`.
    pub fn release(&self) {
        let _ = self.commands.try_send(Command::Release);
    }

    /// Whether the provider process still runs.
    pub fn is_running(&self) -> bool {
        !self.ended.load(Ordering::Acquire) && !self.commands.is_closed()
    }

    /// Whether the actor exited.
    pub fn is_gone(&self) -> bool {
        self.commands.is_closed()
    }
}

/// A session's status, its one sequence counter, and its subscribers.
pub struct Fanout {
    session: Identifier,
    status: SessionStatus,
    /// The sequence at which the status last changed.
    status_at: u64,
    sequences: SequenceCounter,
    subscribers: Vec<Subscriber>,
    ended: Arc<AtomicBool>,
    watchers: StatusSink,
}

impl Fanout {
    pub fn new(session: Identifier, handle: &SessionHandle, watchers: StatusSink) -> Self {
        Self {
            session,
            status: SessionStatus::Starting,
            status_at: 0,
            sequences: SequenceCounter::new(),
            subscribers: Vec::new(),
            ended: Arc::clone(&handle.ended),
            watchers,
        }
    }

    pub fn session(&self) -> &Identifier {
        &self.session
    }

    /// The next sequence for a message that changes state.
    pub fn next_sequence(&mut self) -> NonZeroU64 {
        self.sequences.advance()
    }

    /// The last sequence sent, for messages that repeat state to one subscriber.
    pub fn last_sequence(&self) -> NonZeroU64 {
        NonZeroU64::new(self.sequences.last()).unwrap_or(NonZeroU64::MIN)
    }

    /// Applies `event` and reports the new status. An out-of-order event keeps the status.
    pub fn change(&mut self, event: SessionEvent) {
        let Ok(next) = self.status.apply(event) else {
            return;
        };
        self.status = next;
        self.status_at = self.sequences.advance().get();
        if next.is_ended() {
            self.ended.store(true, Ordering::Release);
        }
        let message = self.status_message();
        let _ = self.watchers.send(message.clone());
        self.broadcast(message);
    }

    /// Sends `message` to every subscriber and drops those whose connection is gone.
    pub fn broadcast(&mut self, message: HostMessage) {
        let session = &self.session;
        self.subscribers
            .retain_mut(|subscriber| subscriber.control(session, message.clone()));
    }

    /// Sends terminal bytes to every subscriber.
    pub fn terminal(&mut self, channel: u32, sequence: u64, bytes: &Arc<Vec<u8>>) {
        let session = &self.session;
        self.subscribers
            .retain_mut(|subscriber| subscriber.terminal(session, channel, sequence, bytes));
    }

    /// Adds `subscriber` after its replay, ending the catch-up with the current status.
    pub fn subscribe(&mut self, mut subscriber: Subscriber, replayed: bool) {
        self.detach(subscriber.connection);
        let alive = replayed && subscriber.control(&self.session, self.status_message());
        if alive {
            self.subscribers.push(subscriber);
        }
    }

    pub fn detach(&mut self, connection: u64) {
        self.subscribers
            .retain(|subscriber| subscriber.connection != connection);
    }

    fn status_message(&self) -> HostMessage {
        let sequence = NonZeroU64::new(self.status_at).unwrap_or(NonZeroU64::MIN);
        messages::status(&self.session, sequence, self.status)
    }
}

/// Serves commands after the session ended, until `ENDED_RETENTION` passes or every handle drops.
pub async fn linger(commands: &mut mpsc::Receiver<Command>, mut serve: impl FnMut(Command)) {
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
