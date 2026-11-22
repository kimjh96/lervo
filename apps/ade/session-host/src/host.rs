//! The session registry and the handling of client messages.

use std::collections::HashMap;
use std::num::NonZeroU64;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use lervo_session_core::paging::Direction;
use lervo_session_protocol::codec::MessageCodec;
use lervo_session_protocol::{
    ClientMessage, ConversationRangeMessageDirection, HostMessage, Identifier,
    RequestFailedMessageCode,
};
use lervo_session_transport::handshake::HostIdentity;
use lervo_session_transport::token::Token;
use tokio::sync::mpsc;

use crate::messages;
use crate::ports::{ConversationMode, Core, Launch};
use crate::session::{Command, Range, Reply, SessionHandle};
use crate::subscriber::{Outgoing, Subscriber};
use crate::{native, terminal};

/// Sessions by identifier, and the session of each terminal channel.
#[derive(Default)]
struct Registry {
    sessions: HashMap<Identifier, SessionHandle>,
    channels: HashMap<u32, Identifier>,
}

impl Registry {
    /// Forgets sessions whose actor exited, so the registry stays as large as the live sessions.
    fn prune(&mut self) {
        self.sessions.retain(|_, handle| !handle.is_gone());
        let sessions = &self.sessions;
        self.channels
            .retain(|_, session| sessions.contains_key(session));
    }
}

/// The running session host: its core port, identity, token, and sessions.
pub struct Host<C> {
    pub core: C,
    pub codec: MessageCodec,
    pub token: Token,
    pub identity: HostIdentity,
    indexes: PathBuf,
    registry: Mutex<Registry>,
    next_channel: AtomicU32,
}

impl<C: Core> Host<C> {
    pub fn new(
        core: C,
        codec: MessageCodec,
        token: Token,
        identity: HostIdentity,
        indexes: PathBuf,
    ) -> Self {
        Self {
            core,
            codec,
            token,
            identity,
            indexes,
            registry: Mutex::new(Registry::default()),
            next_channel: AtomicU32::new(1),
        }
    }

    /// Handles one validated message from `connection`. Requests that wait on the core run on
    /// their own task, so they never hold up the connection's other messages.
    pub async fn handle(
        self: &Arc<Self>,
        connection: u64,
        message: ClientMessage,
        outgoing: &mpsc::UnboundedSender<Outgoing>,
    ) {
        let reply = Reply::new(outgoing);
        match message {
            ClientMessage::HelloMessage(_) => {}
            ClientMessage::ApplicationCommandMessage(command) => {
                let host = Arc::clone(self);
                tokio::spawn(async move {
                    let request = command.request_id;
                    match host
                        .core
                        .command(command.command.as_str(), command.arguments)
                        .await
                    {
                        Err(code) => reply.send(messages::core_failed(&request, code)),
                        Ok(outcome) => {
                            reply.send(messages::application_result(&request, outcome.result));
                            if let Some(launch) = outcome.launch {
                                reply.send(host.open(&request, &launch));
                            }
                        }
                    }
                });
            }
            ClientMessage::SessionOpenMessage(open) => {
                let host = Arc::clone(self);
                tokio::spawn(async move {
                    let message = match host.core.open(open.workspace_id.as_str()).await {
                        Ok(launch) => host.open(&open.request_id, &launch),
                        Err(code) => messages::core_failed(&open.request_id, code),
                    };
                    reply.send(message);
                });
            }
            ClientMessage::SessionAttachMessage(attach) => {
                let command = Command::Attach {
                    after_sequence: attach.after_sequence,
                    subscriber: Subscriber::new(connection, outgoing.clone()),
                };
                self.request(&attach.session_id, &attach.request_id, command, &reply)
                    .await;
            }
            ClientMessage::SessionDetachMessage(detach) => {
                self.send(&detach.session_id, Command::Detach { connection })
                    .await;
            }
            ClientMessage::SessionSendMessage(send) => {
                let command = Command::Send {
                    request: send.request_id.clone(),
                    text: send.text.to_string(),
                    reply: Reply::new(outgoing),
                };
                self.request(&send.session_id, &send.request_id, command, &reply)
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
                    reply: Reply::new(outgoing),
                });
                self.request(&range.session_id, &range.request_id, command, &reply)
                    .await;
            }
        }
    }

    /// Forwards terminal input for `channel` to its session.
    pub async fn input(&self, channel: u32, bytes: Vec<u8>) {
        let session = self.lock().channels.get(&channel).cloned();
        if let Some(session) = session {
            self.send(&session, Command::Input(bytes)).await;
        }
    }

    /// Detaches `connection` from every session.
    pub async fn detach_all(&self, connection: u64) {
        let sessions: Vec<_> = self.lock().sessions.values().cloned().collect();
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
        let handle = self.lock().sessions.get(session).cloned();
        match handle {
            Some(handle) => handle.send(command).await,
            None => false,
        }
    }

    /// Starts the session of `launch`, or confirms it when it already runs.
    fn open(&self, request: &Identifier, launch: &Launch) -> HostMessage {
        let (Some(session), Some(workspace)) = (
            messages::identifier(&launch.session_id),
            messages::identifier(&launch.workspace_id),
        ) else {
            return messages::failed(request, RequestFailedMessageCode::WorkspaceStartFailed);
        };
        let mut registry = self.lock();
        registry.prune();
        if let Some(running) = registry
            .sessions
            .get(&session)
            .filter(|handle| handle.is_running())
        {
            return opened(request, &session, &workspace, running);
        }
        let channel = self.next_channel.fetch_add(1, Ordering::Relaxed);
        let started = match launch.mode {
            ConversationMode::Cli => terminal::start(launch, session.clone(), channel)
                .map_err(|_| RequestFailedMessageCode::ProviderCliUnavailable),
            ConversationMode::Native => native::start(
                launch,
                session.clone(),
                channel,
                self.core.decoder(launch),
                &native::IndexPlace {
                    root: &self.indexes,
                    in_use: &registry
                        .sessions
                        .keys()
                        .map(|id| id.as_str())
                        .collect::<Vec<_>>(),
                },
            )
            .map_err(|error| match error {
                native::StartError::Process(_) => RequestFailedMessageCode::ProviderCliUnavailable,
                native::StartError::Index(_) | native::StartError::IndexDirectory(_) => {
                    RequestFailedMessageCode::ConversationIndexCorrupt
                }
            }),
        };
        match started {
            Ok(handle) => {
                let message = opened(request, &session, &workspace, &handle);
                registry.channels.insert(channel, session.clone());
                registry.sessions.insert(session, handle);
                message
            }
            Err(code) => messages::failed(request, code),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Registry> {
        self.registry
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

fn opened(
    request: &Identifier,
    session: &Identifier,
    workspace: &Identifier,
    handle: &SessionHandle,
) -> HostMessage {
    let channel = NonZeroU64::new(u64::from(handle.channel)).unwrap_or(NonZeroU64::MIN);
    messages::opened(request, session, workspace, handle.mode, channel)
}
