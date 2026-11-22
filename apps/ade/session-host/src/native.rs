//! The native conversation's actor: the provider's structured stream, decoded by the core's
//! adapter into conversation items that the index stores and subscribers receive.

use std::path::{Path, PathBuf};
use std::time::Duration;

use lervo_session_core::paging::{item_id, page};
use lervo_session_core::retention::INDEX_CAP_BYTES;
use lervo_session_core::status::{EndReason, SessionEvent};
use lervo_session_core::transcript::{Change, Input, Item, Transcript};
use lervo_session_protocol::codec::{decode_record, encode};
use lervo_session_protocol::{ConversationItem, Identifier, RequestFailedMessageCode};
use lervo_session_store::{ConversationStore, StoreError, retention};
use lervo_session_stream::{StreamCommand, StreamError, StreamProcess};
use tokio::sync::mpsc;

use crate::items::to_wire;
use crate::messages;
use crate::session::{Command, Fanout, Range, SessionHandle, linger};
use lervo_session_core::ports::{ConversationMode, Decoded, Launch, StreamDecoder};

/// Bytes of sealed segments one session keeps in memory.
const SEGMENT_CACHE_BYTES: usize = 1024 * 1024;
/// How long a provider may run after closing its output before the session host stops it.
const EXIT_GRACE: Duration = Duration::from_secs(5);

/// Why a native session did not start.
#[derive(Debug, thiserror::Error)]
pub enum StartError {
    #[error(transparent)]
    Process(#[from] StreamError),
    #[error(transparent)]
    Index(#[from] StoreError),
    #[error("conversation_index_unavailable: {0}")]
    IndexDirectory(#[from] std::io::Error),
}

/// Where a native session keeps its index.
pub struct IndexPlace<'a> {
    /// The directory of all conversation indexes.
    pub root: &'a Path,
    /// Sessions whose indexes are in use and must survive the cap.
    pub in_use: &'a [&'a str],
}

/// Starts `launch` with piped streams. The index lives in `<root>/<session>`; opening it applies
/// the cap on all indexes.
pub fn start<D: StreamDecoder>(
    launch: &Launch,
    session: Identifier,
    channel: u32,
    decoder: D,
    indexes: &IndexPlace<'_>,
) -> Result<SessionHandle, StartError> {
    let directory: PathBuf = indexes.root.join(session.as_str());
    retention::touch(&directory)?;
    let mut keep = indexes.in_use.to_vec();
    keep.push(session.as_str());
    retention::enforce(indexes.root, INDEX_CAP_BYTES, &keep)?;
    let store = ConversationStore::open(&directory, SEGMENT_CACHE_BYTES)?;
    let process = StreamProcess::spawn(&StreamCommand {
        program: launch.program.clone(),
        arguments: launch.arguments.clone(),
        environment: launch.environment.clone(),
        working_directory: launch.working_directory.clone(),
    })?;
    let (handle, commands) = SessionHandle::new(ConversationMode::Native, channel);
    let actor = Native {
        fanout: Fanout::new(session, &handle),
        initial_input: launch.initial_input.clone(),
        transcript: Transcript::new(store.len()),
        store: Some(store),
        decoder,
    };
    tokio::spawn(actor.run(process, commands));
    Ok(handle)
}

struct Native<D> {
    fanout: Fanout,
    /// The first instruction, sent through the decoder once the provider runs.
    initial_input: Option<String>,
    transcript: Transcript,
    /// `None` once the index failed; live items still flow, and ranges report the damage.
    store: Option<ConversationStore>,
    decoder: D,
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
        loop {
            tokio::select! {
                output = process.output() => match output {
                    Ok(Some(bytes)) => {
                        let decoded = self.decoder.output(&bytes).await;
                        self.apply(decoded);
                    }
                    Ok(None) | Err(_) => break,
                },
                command = commands.recv() => match command {
                    Some(Command::Stop) => {
                        stopped = true;
                        let _ = process.kill().await;
                    }
                    Some(Command::Send { request, text, reply }) => {
                        let (bytes, decoded) = self.decoder.send(&text).await;
                        if process.input(&bytes).await.is_ok() {
                            self.apply(decoded);
                        } else {
                            reply.send(messages::failed(&request, RequestFailedMessageCode::SessionEnded));
                        }
                    }
                    Some(command) => self.command(command),
                    None => {
                        let _ = process.kill().await;
                        break;
                    }
                },
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
                    replayed = subscriber.control(self.fanout.session(), message);
                }
                self.fanout.subscribe(subscriber, replayed);
            }
            Command::Detach { connection } => self.fanout.detach(connection),
            Command::Range(range) => self.range(range),
            Command::Send { request, reply, .. } => {
                reply.send(messages::failed(
                    &request,
                    RequestFailedMessageCode::SessionEnded,
                ));
            }
            Command::Input(_) | Command::Resize { .. } | Command::Stop => {}
        }
    }

    fn apply(&mut self, decoded: Vec<Decoded>) {
        for decoded in decoded {
            match decoded {
                Decoded::Status(event) => self.fanout.change(event),
                Decoded::Conversation(input) => {
                    for change in self.transcript.apply(input) {
                        self.change(change);
                    }
                }
            }
        }
    }

    fn change(&mut self, change: Change) {
        let message = match change {
            Change::Appended(item) | Change::Completed(item) => {
                if !item.streaming {
                    self.store(&item);
                }
                let Some(wire) = to_wire(&item) else {
                    self.store = None;
                    return;
                };
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
        self.fanout.broadcast(message);
    }

    /// Stores a complete item at its position. Any failure marks the index damaged.
    fn store(&mut self, item: &Item) {
        let Some(store) = self.store.as_mut() else {
            return;
        };
        let stored = store.len() == item.position
            && to_wire(item)
                .and_then(|wire| encode(&wire).ok())
                .is_some_and(|record| store.append(&record).is_ok());
        if !stored {
            self.store = None;
        }
    }

    fn range(&mut self, range: Range) {
        let session = self.fanout.session().clone();
        let page = match page(
            self.transcript.len(),
            range.anchor.as_deref(),
            range.direction,
            range.limit,
        ) {
            Ok(page) => page,
            Err(_) => {
                range.reply.send(messages::failed(
                    &range.request,
                    RequestFailedMessageCode::RangeInvalid,
                ));
                return;
            }
        };
        let Some(items) = self.items(page.start, page.end) else {
            range.reply.send(messages::failed(
                &range.request,
                RequestFailedMessageCode::ConversationIndexCorrupt,
            ));
            return;
        };
        range.reply.send(messages::page(
            &range.request,
            &session,
            items,
            page.has_earlier,
            page.has_later,
        ));
    }

    /// Items `[start, end)`: stored ones from the index and the open one from memory.
    fn items(&mut self, start: u64, end: u64) -> Option<Vec<ConversationItem>> {
        let store = self.store.as_mut()?;
        let stored_end = end.min(store.len());
        let mut items = Vec::new();
        if start < stored_end {
            for record in store.read(start, stored_end).ok()? {
                items.push(decode_record(&record).ok()?);
            }
        }
        if let Some(open) = self.transcript.open()
            && (start..end).contains(&open.position)
        {
            items.push(to_wire(open)?);
        }
        Some(items)
    }
}
