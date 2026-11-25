//! The native conversation's actor: the provider's structured stream, decoded by the core's
//! adapter into conversation items that the index stores and subscribers receive.

use std::path::PathBuf;
use std::pin::Pin;
use std::time::Duration;

use lervo_session_core::paging::{item_id, page};
use lervo_session_core::retention::INDEX_CAP_BYTES;
use lervo_session_core::status::{EndReason, SessionEvent};
use lervo_session_core::transcript::{Change, Input, Transcript, coalesce};
use lervo_session_protocol::codec::{decode_record, encode};
use lervo_session_protocol::{ConversationItem, Identifier, RequestFailedMessageCode};
use lervo_session_store::{StoreError, retention};
use lervo_session_stream::{StreamCommand, StreamError, StreamProcess};
use tokio::sync::mpsc;
use tokio::time::Sleep;

use crate::index::Index;
use crate::items::to_wire;
use crate::messages;
use crate::rebuild;
use crate::session::{Command, Fanout, Range, SessionHandle, StatusSink, linger};
use lervo_session_core::ports::{ConversationMode, Decoded, Launch, StreamDecoder};

/// Bytes of sealed segments one session keeps in memory.
const SEGMENT_CACHE_BYTES: usize = 1024 * 1024;
/// How long a provider may run after closing its output before the session host stops it.
const EXIT_GRACE: Duration = Duration::from_secs(5);
/// How long a provider asked to end with SIGTERM may take to run its own shutdown, such as its
/// session-end hook, before the session host kills it. It stays below the lifecycle's 10-second
/// stop deadline, so a mode switch never times out on a slow hook; a hook cut short leaves the
/// end to the exit report.
const STOP_GRACE: Duration = Duration::from_secs(8);

/// Called once with the provider's exit code, or none after a signal, when its process ended.
pub(crate) type ExitReport = Box<dyn FnOnce(Option<u8>) + Send>;

/// Why a native session did not start.
#[derive(Debug, thiserror::Error)]
pub(crate) enum StartError {
    #[error(transparent)]
    Process(#[from] StreamError),
    #[error(transparent)]
    Index(#[from] StoreError),
    #[error("conversation_index_unavailable: {0}")]
    IndexDirectory(#[from] std::io::Error),
}

/// Where a native session keeps its index.
pub(crate) struct IndexPlace {
    /// The directory of all conversation indexes.
    pub(crate) root: PathBuf,
    /// Sessions whose indexes are in use and must survive the cap.
    pub(crate) in_use: Vec<String>,
}

/// A native session whose index is open and whose provider process runs, before its actor does.
pub(crate) struct Prepared<D> {
    session: Identifier,
    channel: u32,
    initial_input: Option<String>,
    stored: u64,
    index: Index,
    process: StreamProcess,
    decoder: D,
}

/// Opens the index in `<root>/<session>`, applying the cap on all indexes, and starts `launch`
/// with piped streams. This is blocking file and process work: the lifecycle runs it off the
/// async workers and outside the registry's lock.
///
/// With the provider's `transcript`, the index is rebuilt from it first when it holds a different
/// number of items, so turns from the CLI conversation appear here too.
pub(crate) fn prepare<D: StreamDecoder>(
    launch: &Launch,
    session: Identifier,
    channel: u32,
    decoder: D,
    indexes: &IndexPlace,
    transcript: Option<Vec<Input>>,
) -> Result<Prepared<D>, StartError> {
    let directory: PathBuf = indexes.root.join(session.as_str());
    retention::touch(&directory)?;
    let mut keep: Vec<&str> = indexes.in_use.iter().map(String::as_str).collect();
    keep.push(session.as_str());
    retention::enforce(&indexes.root, INDEX_CAP_BYTES, &keep)?;
    let store = rebuild::open_synced(
        &directory,
        SEGMENT_CACHE_BYTES,
        transcript.map(rebuild::projected),
    )?;
    let stored = store.len();
    let index = Index::spawn(store)?;
    let process = StreamProcess::spawn(&StreamCommand {
        program: launch.program.clone(),
        arguments: launch.arguments.clone(),
        environment: launch.environment.clone(),
        environment_remove: launch.environment_remove.clone(),
        working_directory: launch.working_directory.clone(),
    })?;
    Ok(Prepared {
        session,
        channel,
        initial_input: launch.initial_input.clone(),
        stored,
        index,
        process,
        decoder,
    })
}

impl<D: StreamDecoder> Prepared<D> {
    /// Starts the session's actor and returns its handle.
    pub(crate) fn start(self, watchers: StatusSink, on_exit: ExitReport) -> SessionHandle {
        let (handle, commands, ended) = SessionHandle::new(ConversationMode::Native, self.channel);
        let actor = Native {
            fanout: Fanout::new(self.session, ended, watchers),
            initial_input: self.initial_input,
            transcript: Transcript::new(self.stored),
            index: self.index,
            decoder: self.decoder,
            on_exit: Some(on_exit),
        };
        tokio::spawn(actor.run(self.process, commands));
        handle
    }
}

struct Native<D> {
    fanout: Fanout,
    /// The first instruction, sent through the decoder once the provider runs.
    initial_input: Option<String>,
    transcript: Transcript,
    /// Damaged once storing failed; live items still flow, and ranges report the damage.
    index: Index,
    decoder: D,
    on_exit: Option<ExitReport>,
}

impl<D: StreamDecoder> Native<D> {
    async fn run(mut self, mut process: StreamProcess, mut commands: mpsc::Receiver<Command>) {
        self.fanout.change(SessionEvent::Launched);
        if let Some(text) = self.initial_input.take() {
            let (bytes, decoded) = self.decoder.send(&text).await;
            if process.input(&bytes).await.is_ok() {
                self.apply(decoded);
            }
        }
        let mut stopped = false;
        let mut listening = true;
        // Armed once the provider is asked to end; a provider still running then is killed.
        let kill = tokio::time::sleep(Duration::ZERO);
        tokio::pin!(kill);
        let mut kill_armed = false;
        loop {
            tokio::select! {
                output = process.output() => match output {
                    Ok(Some(bytes)) => {
                        let decoded = self.decoder.output(&bytes).await;
                        self.apply(decoded);
                    }
                    Ok(None) | Err(_) => break,
                },
                command = commands.recv(), if listening => match command {
                    Some(Command::Stop) => {
                        stopped = true;
                        ask_to_end(&mut process, kill.as_mut(), &mut kill_armed).await;
                    }
                    Some(Command::Send { request, text, reply }) => {
                        let (bytes, decoded) = self.decoder.send(&text).await;
                        if process.input(&bytes).await.is_ok() {
                            self.apply(decoded);
                            reply.send(messages::sent(&request, self.fanout.session()));
                        } else {
                            reply.send(messages::failed(&request, RequestFailedMessageCode::SessionEnded));
                        }
                    }
                    Some(Command::Interrupt { request, reply }) => {
                        match self.decoder.interrupt().await {
                            Ok((bytes, decoded)) => {
                                if bytes.is_empty() || process.input(&bytes).await.is_ok() {
                                    self.apply(decoded);
                                    reply.send(messages::interrupted(&request, self.fanout.session()));
                                } else {
                                    reply.send(messages::failed(&request, RequestFailedMessageCode::SessionEnded));
                                }
                            }
                            Err(failure) => reply.send(messages::core_failed(&request, &failure)),
                        }
                    }
                    Some(command) => self.command(command),
                    None => {
                        listening = false;
                        ask_to_end(&mut process, kill.as_mut(), &mut kill_armed).await;
                    }
                },
                () = &mut kill, if kill_armed => {
                    kill_armed = false;
                    let _ = process.kill().await;
                }
            }
        }
        self.apply(vec![Decoded::Conversation(Input::Finish)]);
        process.close_input();
        let exit = match tokio::time::timeout(EXIT_GRACE, process.wait()).await {
            Ok(exit) => exit,
            Err(_) => {
                let _ = process.kill().await;
                process.wait().await
            }
        };
        let code = exit
            .as_ref()
            .ok()
            .and_then(|exit| exit.code)
            .and_then(|code| u8::try_from(code).ok());
        if let Some(report) = self.on_exit.take() {
            report(code);
        }
        let exited_cleanly = exit.ok().map(|exit| exit.success);
        self.fanout.change(SessionEvent::Exited(EndReason::of_exit(
            stopped,
            exited_cleanly,
        )));
        linger(&mut commands, |command| self.command(command)).await;
    }

    fn command(&mut self, command: Command) {
        match command {
            Command::Attach { mut subscriber, .. } => {
                // The open item is the only live state outside the index. Clients load stored
                // items with `conversation.range` and keep items by `itemId`, so repeats are safe.
                let mut replayed = true;
                if let Some(item) = self.transcript.open().and_then(to_wire) {
                    let message = messages::appended(
                        self.fanout.session(),
                        self.fanout.last_sequence(),
                        vec![item],
                    );
                    replayed = subscriber.control(self.fanout.session(), &message);
                }
                self.fanout.subscribe(subscriber, replayed);
            }
            Command::Detach { connection } => self.fanout.detach(connection),
            Command::Range(range) => self.range(range),
            Command::Send { request, reply, .. } | Command::Interrupt { request, reply } => {
                reply.send(messages::failed(
                    &request,
                    RequestFailedMessageCode::SessionEnded,
                ));
            }
            Command::Input(_) | Command::Resize { .. } | Command::Stop | Command::Release => {}
        }
    }

    /// Applies decoded events in order. Conversation changes between two status changes merge
    /// their deltas, so text never moves past a status message.
    fn apply(&mut self, decoded: Vec<Decoded>) {
        let mut pending = Vec::new();
        for decoded in decoded {
            match decoded {
                Decoded::Status(event) => {
                    self.flush(&mut pending);
                    self.fanout.change(event);
                }
                Decoded::Conversation(input) => pending.extend(self.transcript.apply(input)),
            }
        }
        self.flush(&mut pending);
    }

    fn flush(&mut self, pending: &mut Vec<Change>) {
        for change in coalesce(std::mem::take(pending)) {
            self.change(change);
        }
    }

    fn change(&mut self, change: Change) {
        let message = match change {
            Change::Appended(item) | Change::Completed(item) => {
                let Some(wire) = to_wire(&item) else {
                    self.index.damage();
                    return;
                };
                if !item.streaming {
                    match encode(&wire) {
                        Ok(record) => self.index.append(item.position, record),
                        Err(_) => self.index.damage(),
                    }
                }
                let sequence = self.fanout.next_sequence();
                messages::appended(self.fanout.session(), sequence, vec![wire])
            }
            Change::Delta { position, text } => {
                let sequence = self.fanout.next_sequence();
                let Some(message) =
                    messages::delta(self.fanout.session(), sequence, &item_id(position), &text)
                else {
                    return;
                };
                message
            }
        };
        self.fanout.broadcast(&message);
    }

    /// Answers a range: stored items come from the index thread and the open item from memory.
    /// The answer waits on its own task, so the actor keeps serving the stream meanwhile.
    fn range(&mut self, range: Range) {
        let session = self.fanout.session().clone();
        let Ok(page) = page(
            self.transcript.len(),
            range.anchor.as_deref(),
            range.direction,
            range.limit,
        ) else {
            range.reply.send(messages::failed(
                &range.request,
                RequestFailedMessageCode::RangeInvalid,
            ));
            return;
        };
        let open = match self
            .transcript
            .open()
            .filter(|open| (page.start..page.end).contains(&open.position))
        {
            Some(open) => match to_wire(open) {
                Some(item) => Some(item),
                None => {
                    range.reply.send(messages::failed(
                        &range.request,
                        RequestFailedMessageCode::ConversationIndexCorrupt,
                    ));
                    return;
                }
            },
            None => None,
        };
        let records = self.index.read(page.start, page.end);
        tokio::spawn(async move {
            let items = records.await.ok().flatten().and_then(|records| {
                let mut items = records
                    .iter()
                    .map(|record| decode_record::<ConversationItem>(record).ok())
                    .collect::<Option<Vec<_>>>()?;
                items.extend(open);
                Some(items)
            });
            range.reply.send(match items {
                Some(items) => messages::page(
                    &range.request,
                    &session,
                    items,
                    page.has_earlier,
                    page.has_later,
                ),
                None => messages::failed(
                    &range.request,
                    RequestFailedMessageCode::ConversationIndexCorrupt,
                ),
            });
        });
    }
}

/// Asks the provider to end with SIGTERM, so it runs its own shutdown, such as a session-end
/// hook, and arms the kill that follows `STOP_GRACE` later. A provider that cannot be signalled
/// is killed at once.
async fn ask_to_end(process: &mut StreamProcess, kill: Pin<&mut Sleep>, armed: &mut bool) {
    if *armed {
        return;
    }
    if process.terminate().is_ok() {
        kill.reset(tokio::time::Instant::now() + STOP_GRACE);
        *armed = true;
    } else {
        let _ = process.kill().await;
    }
}
