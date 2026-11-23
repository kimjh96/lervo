//! The CLI conversation's actor: the provider's interactive CLI in a PTY, with a bounded
//! scrollback for clients that attach later.

use std::collections::VecDeque;
use std::sync::Arc;

use lervo_session_core::scrollback::{
    DEFAULT_SCROLLBACK_BYTES, ENDED_SCROLLBACK_BYTES, Scrollback,
};
use lervo_session_core::status::{EndReason, SessionEvent};
use lervo_session_protocol::{Identifier, RequestFailedMessageCode};
use lervo_session_pty::{PtyCommand, PtyError, PtyProcess};
use tokio::sync::mpsc;

use crate::messages;
use crate::session::{Command, Fanout, SessionHandle, StatusSink, linger};
use lervo_session_core::ports::{ConversationMode, Launch};

const INITIAL_COLUMNS: u16 = 120;
const INITIAL_ROWS: u16 = 40;
/// Input bytes the actor holds while the process does not read. Beyond this the actor stops
/// taking commands, so the connection that sends input waits instead of memory growing.
const PENDING_INPUT_BYTES: usize = 4 * 1024 * 1024;

/// A CLI session whose process runs in its PTY, before its actor does.
pub(crate) struct Prepared {
    session: Identifier,
    channel: u32,
    process: PtyProcess,
}

/// Starts `launch` in a PTY. Spawning is blocking process work: the lifecycle runs it off the
/// async workers and outside the registry's lock.
pub(crate) fn prepare(
    launch: &Launch,
    session: Identifier,
    channel: u32,
) -> Result<Prepared, PtyError> {
    let process = PtyProcess::spawn(&PtyCommand {
        program: launch.program.clone(),
        arguments: launch.arguments.clone(),
        environment: launch.environment.clone(),
        environment_remove: launch.environment_remove.clone(),
        working_directory: launch.working_directory.clone(),
        columns: INITIAL_COLUMNS,
        rows: INITIAL_ROWS,
    })?;
    Ok(Prepared {
        session,
        channel,
        process,
    })
}

impl Prepared {
    /// Starts the session's actor and returns its handle.
    pub(crate) fn start(self, watchers: StatusSink) -> SessionHandle {
        let (handle, commands, ended) = SessionHandle::new(ConversationMode::Cli, self.channel);
        let actor = Terminal {
            fanout: Fanout::new(self.session, ended, watchers),
            channel: self.channel,
            scrollback: Scrollback::new(DEFAULT_SCROLLBACK_BYTES),
            pending: VecDeque::new(),
            pending_bytes: 0,
        };
        tokio::spawn(actor.run(self.process, commands));
        handle
    }
}

struct Terminal {
    fanout: Fanout,
    channel: u32,
    scrollback: Scrollback,
    /// Input waiting for the PTY's writer, oldest first.
    pending: VecDeque<Vec<u8>>,
    pending_bytes: usize,
}

/// How the actor's loop ended.
enum Ending {
    /// The process closed its output.
    Closed,
    /// A client stopped it, or every handle dropped.
    Stopped,
    /// The PTY refused input or a resize, so the session cannot continue.
    Broken,
}

impl Terminal {
    async fn run(mut self, mut process: PtyProcess, mut commands: mpsc::Receiver<Command>) {
        self.fanout.change(SessionEvent::Launched);
        let input = process.input().clone();
        let ending = loop {
            tokio::select! {
                output = process.output() => match output {
                    Some(bytes) => self.output(bytes),
                    None => break Ending::Closed,
                },
                // The actor never waits on a write, so it keeps reading output while the process
                // takes its input; otherwise a process that writes before it reads would deadlock.
                permit = input.reserve(), if !self.pending.is_empty() => match permit {
                    Ok(permit) => {
                        if let Some(bytes) = self.pending.pop_front() {
                            self.pending_bytes -= bytes.len();
                            permit.send(bytes);
                        }
                    }
                    Err(_) => break Ending::Broken,
                },
                command = commands.recv(), if self.pending_bytes < PENDING_INPUT_BYTES => {
                    match command {
                        Some(Command::Stop) | None => break Ending::Stopped,
                        Some(Command::Input(bytes)) => {
                            self.pending_bytes += bytes.len();
                            self.pending.push_back(bytes);
                        }
                        Some(Command::Resize { columns, rows }) => {
                            if process.resize(columns, rows).is_err() {
                                break Ending::Broken;
                            }
                        }
                        Some(command) => self.command(command),
                    }
                }
            }
        };
        if !matches!(ending, Ending::Closed) {
            let _ = process.kill();
        }
        self.pending.clear();
        let exit = tokio::task::spawn_blocking(move || process.wait()).await;
        let exited_cleanly = match (&ending, exit) {
            (Ending::Broken, _) => None,
            (_, Ok(Ok(exit))) => Some(exit.success),
            _ => None,
        };
        self.fanout.change(SessionEvent::Exited(EndReason::of_exit(
            matches!(ending, Ending::Stopped),
            exited_cleanly,
        )));
        self.scrollback.shrink_to(ENDED_SCROLLBACK_BYTES);
        linger(&mut commands, |command| self.command(command)).await;
    }

    /// Commands that do not touch the process, served while it runs and after it ended.
    fn command(&mut self, command: Command) {
        match command {
            Command::Attach {
                after_sequence,
                mut subscriber,
            } => {
                let mut replayed = true;
                for (sequence, bytes) in self.scrollback.since(after_sequence) {
                    replayed &=
                        subscriber.terminal(self.fanout.session(), self.channel, sequence, bytes);
                }
                self.fanout.subscribe(subscriber, replayed);
            }
            Command::Detach { connection } => self.fanout.detach(connection),
            Command::Send { request, reply, .. } => reply.send(messages::failed(
                &request,
                RequestFailedMessageCode::ConversationModeUnsupported,
            )),
            // The CLI conversation has no items; the terminal carries it.
            Command::Range(range) => range.reply.send(messages::page(
                &range.request,
                self.fanout.session(),
                Vec::new(),
                false,
                false,
            )),
            // After the end, input and resizes have no process to reach.
            Command::Input(_) | Command::Resize { .. } | Command::Stop | Command::Release => {}
        }
    }

    fn output(&mut self, bytes: Arc<[u8]>) {
        let sequence = self.fanout.next_sequence().get();
        self.scrollback.push(sequence, &bytes);
        self.fanout.terminal(self.channel, sequence, &bytes);
    }
}
