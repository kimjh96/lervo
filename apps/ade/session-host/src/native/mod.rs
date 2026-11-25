//! The native conversation's actor: the provider's structured stream, decoded by the core's
//! adapter into conversation items that the index stores and subscribers receive.

use std::path::PathBuf;
use std::pin::Pin;
use std::time::Duration;

use lervo_session_core::paging::{item_id, page};
use lervo_session_core::status::{EndReason, SessionEvent};
use lervo_session_core::transcript::{Change, Input, Transcript, coalesce};
use lervo_session_protocol::codec::{decode_record, encode};
use lervo_session_protocol::{ConversationItem, RequestFailedMessageCode};
use lervo_session_stream::StreamProcess;
use tokio::sync::mpsc;
use tokio::time::Sleep;

use crate::images;
use crate::index::Index;
use crate::items::to_wire;
use crate::messages;
use crate::session::{Command, Fanout, Range, linger};
use lervo_session_core::ports::{Decoded, Failure, SentImage, StreamDecoder};

mod prepare;

pub(crate) use prepare::{IndexPlace, StartError, prepare};

/// How long a provider may run after closing its output before the session host stops it.
const EXIT_GRACE: Duration = Duration::from_secs(5);
/// How long a provider asked to end with SIGTERM may take to run its own shutdown, such as its
/// session-end hook, before the session host kills it. It stays below the lifecycle's 10-second
/// stop deadline, so a mode switch never times out on a slow hook; a hook cut short leaves the
/// end to the exit report.
const STOP_GRACE: Duration = Duration::from_secs(8);

/// Called once with the provider's exit code, or none after a signal, when its process ended.
pub(crate) type ExitReport = Box<dyn FnOnce(Option<u8>) + Send>;

struct Native<D> {
    fanout: Fanout,
    /// The first instruction and its images, sent through the decoder once the provider runs.
    initial_input: Option<String>,
    initial_images: Vec<SentImage>,
    /// The session's index directory, which also keeps the images its messages carried.
    directory: PathBuf,
    transcript: Transcript,
    /// Damaged once storing failed; live items still flow, and ranges report the damage.
    index: Index,
    decoder: D,
    on_exit: Option<ExitReport>,
}

impl<D: StreamDecoder> Native<D> {
    /// The bytes and items of the user's message. Its images are kept beside the index first, so
    /// the message's marks name images `image.read` can return.
    async fn encode(
        &mut self,
        text: &str,
        images: &[SentImage],
    ) -> Result<(Vec<u8>, Vec<Decoded>), Failure> {
        if images.is_empty() {
            return Ok(self.decoder.send(text).await);
        }
        images::keep(&self.directory, images);
        self.decoder.send_with_images(text, images).await
    }

    async fn run(mut self, mut process: StreamProcess, mut commands: mpsc::Receiver<Command>) {
        self.fanout.change(SessionEvent::Launched);
        if let Some(text) = self.initial_input.take() {
            let images = std::mem::take(&mut self.initial_images);
            // A decoder that cannot carry images still gets the instruction.
            let encoded = match self.encode(&text, &images).await {
                Ok(encoded) => encoded,
                Err(_) => self.decoder.send(&text).await,
            };
            if process.input(&encoded.0).await.is_ok() {
                self.apply(encoded.1);
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
                    Some(Command::Send { request, text, images, reply }) => {
                        if text.is_empty() && images.is_empty() {
                            reply.send(messages::failed(&request, RequestFailedMessageCode::MessageEmpty));
                            continue;
                        }
                        match self.encode(&text, &images).await {
                            Ok((bytes, decoded)) => {
                                if process.input(&bytes).await.is_ok() {
                                    self.apply(decoded);
                                    reply.send(messages::sent(&request, self.fanout.session()));
                                } else {
                                    reply.send(messages::failed(&request, RequestFailedMessageCode::SessionEnded));
                                }
                            }
                            Err(failure) => reply.send(messages::core_failed(&request, &failure)),
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
