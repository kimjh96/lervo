//! Client messages: each one becomes a session command, a lifecycle call, or a core request. The
//! protocol's types become the domain's here, and nowhere else in the session host.

use std::sync::Arc;

use lervo_session_core::paging::Direction;
use lervo_session_protocol::{
    ClientMessage, ConversationRangeMessageDirection, Identifier, RequestFailedMessageCode,
};

use crate::host::Host;
use crate::images;
use crate::messages;
use crate::session::{Command, Range, Reply};
use crate::subscriber::{Output, Subscriber};
use lervo_session_core::ports::{Core, SentImage};

impl<C: Core> Host<C> {
    /// Handles one validated message from the connection behind `output`. Requests that wait on
    /// the core or on the lifecycle run on their own task, so they never hold up the connection's
    /// other messages.
    pub(crate) async fn handle(self: &Arc<Self>, output: &Output, message: ClientMessage) {
        let reply = Reply::new(output);
        match message {
            ClientMessage::HelloMessage(_) => {}
            ClientMessage::ApplicationCommandMessage(mut command) => {
                // Images pasted with an instruction go with its first message; the core gets the
                // text alone.
                let images = if command.command.as_str() == "workspace.start" {
                    images::take(&mut command.arguments)
                } else {
                    Vec::new()
                };
                // An agent joining a conversation runs beside its lead, never as the workspace's
                // session (Lervo ADE rooms).
                let joins = command.command.as_str() == "room.join";
                let host = Arc::clone(self);
                tokio::spawn(async move {
                    let request = command.request_id;
                    match host
                        .core
                        .command(command.command.as_str(), command.arguments)
                        .await
                    {
                        Err(failure) => reply.send(messages::core_failed(&request, &failure)),
                        Ok(outcome) => {
                            reply.send(messages::application_result(&request, outcome.result));
                            if let Some(mut launch) = outcome.launch {
                                launch.initial_images = images;
                                let started = if joins {
                                    host.start_member(&request, &launch).await
                                } else {
                                    host.start(&request, &launch).await
                                };
                                reply.send(started);
                            }
                        }
                    }
                });
            }
            ClientMessage::ImageReadMessage(read) => {
                let directory = self.indexes.join(read.session_id.as_str());
                tokio::spawn(async move {
                    let id = read.image_id.to_string();
                    let found = {
                        let id = id.clone();
                        tokio::task::spawn_blocking(move || images::read(&directory, &id))
                            .await
                            .ok()
                            .flatten()
                    };
                    reply.send(messages::image_data(
                        &read.request_id,
                        &read.session_id,
                        &id,
                        found,
                    ));
                });
            }
            ClientMessage::SessionOpenMessage(open) => {
                let host = Arc::clone(self);
                tokio::spawn(async move {
                    let mode = open.conversation_mode.map(messages::domain_mode);
                    reply.send(
                        host.open_workspace(&open.request_id, &open.workspace_id, mode)
                            .await,
                    );
                });
            }
            ClientMessage::SessionAttachMessage(attach) => {
                let command = Command::Attach {
                    after_sequence: attach.after_sequence,
                    subscriber: Subscriber::new(output.clone()),
                };
                self.request(&attach.session_id, &attach.request_id, command, &reply)
                    .await;
            }
            ClientMessage::SessionsWatchMessage(_) => self.watch.watch(output.clone()),
            ClientMessage::SessionDetachMessage(detach) => {
                let connection = output.connection;
                self.send(&detach.session_id, Command::Detach { connection })
                    .await;
            }
            ClientMessage::SessionSendMessage(send) => {
                let command = Command::Send {
                    request: send.request_id.clone(),
                    text: send.text.to_string(),
                    images: send
                        .images
                        .iter()
                        .map(|image| SentImage {
                            media_type: image.media_type.to_string(),
                            data: image.data.to_string(),
                        })
                        .collect(),
                    reply: Reply::new(output),
                };
                self.request(&send.session_id, &send.request_id, command, &reply)
                    .await;
            }
            ClientMessage::SessionInterruptMessage(interrupt) => {
                let command = Command::Interrupt {
                    request: interrupt.request_id.clone(),
                    reply: Reply::new(output),
                };
                self.request(
                    &interrupt.session_id,
                    &interrupt.request_id,
                    command,
                    &reply,
                )
                .await;
            }
            ClientMessage::SessionResizeMessage(resize) => {
                let columns = u16::try_from(resize.columns.get()).unwrap_or(u16::MAX);
                let rows = u16::try_from(resize.rows.get()).unwrap_or(u16::MAX);
                self.send(&resize.session_id, Command::Resize { columns, rows })
                    .await;
            }
            ClientMessage::SessionStopMessage(stop) => {
                self.request(&stop.session_id, &stop.request_id, Command::Stop, &reply)
                    .await;
            }
            ClientMessage::ConversationRangeMessage(range) => {
                let command = Command::Range(Range {
                    request: range.request_id.clone(),
                    anchor: range.anchor_item_id.map(|item| item.to_string()),
                    direction: match range.direction {
                        ConversationRangeMessageDirection::Before => Direction::Before,
                        ConversationRangeMessageDirection::After => Direction::After,
                    },
                    limit: range.limit.get(),
                    reply: Reply::new(output),
                });
                self.request(&range.session_id, &range.request_id, command, &reply)
                    .await;
            }
        }
    }

    /// Forwards terminal input for `channel` to its session.
    pub(crate) async fn input(&self, channel: u32, bytes: Vec<u8>) {
        let session = self.registry().channels.get(&channel).cloned();
        if let Some(session) = session {
            self.send(&session, Command::Input(bytes)).await;
        }
    }

    /// Detaches `connection` from every session and from the watch.
    pub(crate) async fn detach_all(&self, connection: u64) {
        self.watch.unwatch(connection);
        let sessions: Vec<_> = self.registry().sessions.values().cloned().collect();
        for session in sessions {
            session.send(Command::Detach { connection }).await;
        }
    }

    async fn request(
        &self,
        session: &Identifier,
        request: &Identifier,
        command: Command,
        reply: &Reply,
    ) {
        if !self.send(session, command).await {
            reply.send(messages::failed(
                request,
                RequestFailedMessageCode::SessionNotFound,
            ));
        }
    }

    async fn send(&self, session: &Identifier, command: Command) -> bool {
        let handle = self.registry().sessions.get(session).cloned();
        match handle {
            Some(handle) => handle.send(command).await,
            None => false,
        }
    }
}
