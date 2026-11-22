//! The CLI conversation's actor: the provider's interactive CLI in a PTY, with a bounded
//! scrollback for clients that attach later.

use std::sync::Arc;

use lervo_session_core::scrollback::{DEFAULT_SCROLLBACK_BYTES, Scrollback};
use lervo_session_core::status::{EndReason, SessionEvent};
use lervo_session_protocol::{Identifier, RequestFailedMessageCode};
use lervo_session_pty::{PtyCommand, PtyError, PtyProcess};
use tokio::sync::mpsc;

use crate::messages;
use crate::ports::{ConversationMode, Launch};
use crate::session::{Command, Fanout, SessionHandle, linger};

const INITIAL_COLUMNS: u16 = 120;
const INITIAL_ROWS: u16 = 40;

/// Starts `launch` in a PTY.
pub fn start(
    launch: &Launch,
    session: Identifier,
    channel: u32,
) -> Result<SessionHandle, PtyError> {
    let process = PtyProcess::spawn(&PtyCommand {
        program: launch.program.clone(),
        arguments: launch.arguments.clone(),
        environment: launch.environment.clone(),
        working_directory: launch.working_directory.clone(),
        columns: INITIAL_COLUMNS,
        rows: INITIAL_ROWS,
    })?;
    let (handle, commands) = SessionHandle::new(ConversationMode::Cli, channel);
    let actor = Terminal {
        fanout: Fanout::new(session, &handle),
        channel,
        scrollback: Scrollback::new(DEFAULT_SCROLLBACK_BYTES),
    };
    tokio::spawn(actor.run(process, commands));
    Ok(handle)
}

struct Terminal {
    fanout: Fanout,
    channel: u32,
    scrollback: Scrollback,
}

impl Terminal {
    async fn run(mut self, mut process: PtyProcess, mut commands: mpsc::Receiver<Command>) {
        self.fanout.change(SessionEvent::Launched);
        let mut stopped = false;
        loop {
            tokio::select! {
                output = process.output() => match output {
                    Some(bytes) => self.output(bytes),
                    None => break,
                },
                command = commands.recv() => match command {
                    Some(Command::Stop) => {
                        stopped = true;
                        let _ = process.kill();
                    }
                    Some(command) => self.command(command, Some(&mut process)),
                    None => {
                        let _ = process.kill();
                        break;
                    }
                },
            }
        }
        let exit = tokio::task::spawn_blocking(move || process.wait()).await;
        let exited_cleanly = match exit {
            Ok(Ok(exit)) => Some(exit.success),
            _ => None,
        };
        self.fanout.change(SessionEvent::Exited(EndReason::of_exit(
            stopped,
            exited_cleanly,
        )));
        linger(&mut commands, |command| self.command(command, None)).await;
    }

    fn command(&mut self, command: Command, process: Option<&mut PtyProcess>) {
        match command {
            Command::Attach {
                after_sequence,
                mut subscriber,
            } => {
                let mut replayed = true;
                for (sequence, bytes) in self.scrollback.since(after_sequence) {
                    let bytes = Arc::new(bytes.to_vec());
                    replayed &=
                        subscriber.terminal(self.fanout.session(), self.channel, sequence, &bytes);
                }
                self.fanout.subscribe(subscriber, replayed);
            }
            Command::Detach { connection } => self.fanout.detach(connection),
            Command::Input(bytes) => {
                if let Some(process) = process {
                    let _ = process.input(&bytes);
                }
            }
            Command::Resize { columns, rows } => {
                if let Some(process) = process {
                    let _ = process.resize(columns, rows);
                }
            }
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
            Command::Stop => {}
        }
    }

    fn output(&mut self, bytes: Vec<u8>) {
        let sequence = self.fanout.next_sequence().get();
        self.scrollback.push(sequence, &bytes);
        self.fanout
            .terminal(self.channel, sequence, &Arc::new(bytes));
    }
}
