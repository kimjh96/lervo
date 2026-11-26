//! Starting sessions and switching their conversation mode. One provider process serves each
//! workspace: a switch stops the running process and waits for its end before the core prepares
//! the next one. Blocking work, such as opening an index or spawning a process, runs off the async
//! workers and outside the registry's lock.

use crate::diagnostics::Field;
use std::num::NonZeroU64;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use lervo_session_protocol::{HostMessage, Identifier, RequestFailedMessageCode};
use lervo_session_pty::PtyError;
use lervo_session_stream::StreamError;

use crate::host::Host;
use crate::messages;
use crate::native::{self, ExitReport, IndexPlace, StartError};
use crate::session::{Command, SessionHandle};
use crate::terminal;
use lervo_session_core::ports::{ConversationMode, Core, Launch};
use lervo_session_core::transcript::{Content, Input};

/// Transcript items in one `transcript.read` page.
const TRANSCRIPT_PAGE: u64 = 500;
/// A transcript larger than this is not read whole, and the index stays as it is.
const MAX_TRANSCRIPT_ITEMS: usize = 100_000;
const MAX_TRANSCRIPT_TEXT_BYTES: usize = 64 * 1024 * 1024;

/// How long a mode switch waits for the running provider process to end. A native session kills
/// its provider 8 seconds after asking it to end, so this leaves room for that.
const STOP_DEADLINE: Duration = Duration::from_secs(10);

/// Whose session a launch starts: the workspace's own, or an agent's that joined its conversation
/// (Lervo ADE rooms). Either's first instruction may perform a delivery: a joining agent's, or the
/// first turn of a conversation its lead started.
pub(crate) enum Role {
    Lead { initial_delivery: Option<String> },
    Member { initial_delivery: Option<String> },
}

impl<C: Core> Host<C> {
    /// The workspace's running session in `mode`, or a session the core prepares. A session that
    /// runs in another mode stops first; if it does not end in time, the switch fails with
    /// `session_stop_timeout` and the session keeps running.
    pub(crate) async fn open_workspace(
        &self,
        request: &Identifier,
        workspace: &Identifier,
        mode: Option<ConversationMode>,
    ) -> HostMessage {
        let _serial = self.lifecycle.lock().await;
        let running = self.registry().running(workspace);
        if let Some((session, handle)) = running {
            if mode.is_none_or(|mode| mode == handle.mode) {
                return opened(request, &session, workspace, &handle);
            }
            handle.send(Command::Stop).await;
            if !handle.ended_within(STOP_DEADLINE).await {
                return messages::failed(request, RequestFailedMessageCode::SessionStopTimeout);
            }
        }
        match self.core.open(workspace.as_str(), mode).await {
            Ok(launch) => self.start_serially(request, &launch).await,
            Err(failure) => messages::core_failed(request, &failure),
        }
    }

    /// Reports the session's exit to the core once its process ends, after the request that
    /// started it has long been answered.
    fn exit_report(&self, session: &Identifier) -> ExitReport {
        let core = Arc::clone(&self.core);
        let session = session.as_str().to_owned();
        Box::new(move |exit_code| {
            tokio::spawn(async move { core.session_exited(&session, exit_code).await });
        })
    }

    /// Starts the session of a launch the core returned with an application command, such as
    /// `workspace.start`, or confirms it when it already runs.
    pub(crate) async fn start(&self, request: &Identifier, launch: &Launch) -> HostMessage {
        let _serial = self.lifecycle.lock().await;
        self.start_serially(request, launch).await
    }

    /// Starts the session of an agent that joins a conversation through `room.join`, such as
    /// one the owner mentions or one the interface reopens, beside the workspace's own session.
    pub(crate) async fn start_member(&self, request: &Identifier, launch: &Launch) -> HostMessage {
        let _serial = self.lifecycle.lock().await;
        let role = Role::Member {
            initial_delivery: None,
        };
        self.start_as(request, launch, role).await
    }

    /// Starts `launch` while the caller holds the lifecycle lock.
    async fn start_serially(&self, request: &Identifier, launch: &Launch) -> HostMessage {
        let role = Role::Lead {
            initial_delivery: None,
        };
        self.start_as(request, launch, role).await
    }

    /// Starts `launch` in its role while the caller holds the lifecycle lock.
    pub(crate) async fn start_as(
        &self,
        request: &Identifier,
        launch: &Launch,
        role: Role,
    ) -> HostMessage {
        let (Some(session), Some(workspace)) = (
            messages::identifier(&launch.session_id),
            messages::identifier(&launch.workspace_id),
        ) else {
            return messages::failed(request, RequestFailedMessageCode::WorkspaceStartFailed);
        };
        let in_use = {
            let mut registry = self.registry();
            registry.prune();
            registry.release_oldest_ended();
            self.watch.retain(registry.live());
            if let Some(running) = registry
                .sessions
                .get(&session)
                .filter(|handle| handle.is_running())
            {
                return opened(request, &session, &workspace, running);
            }
            registry
                .sessions
                .keys()
                .map(|session| session.as_str().to_owned())
                .collect::<Vec<_>>()
        };
        let channel = self.next_channel.fetch_add(1, Ordering::Relaxed);
        let started = match launch.mode {
            ConversationMode::Cli => {
                let (launch, session) = (launch.clone(), session.clone());
                tokio::task::spawn_blocking(move || terminal::prepare(&launch, session, channel))
                    .await
                    .map_err(|_| start_failed(request, "task_failed"))
                    .and_then(|prepared| prepared.map_err(|error| pty_failed(request, &error)))
                    .map(|prepared| prepared.start(self.watch.clone()))
            }
            ConversationMode::Native => {
                let transcript = if launch.transcript {
                    self.transcript(&launch.workspace_id).await
                } else {
                    None
                };
                let on_exit = self.exit_report(&session);
                let (launch, session) = (launch.clone(), session.clone());
                let decoder = self.core.decoder(&launch);
                let place = IndexPlace {
                    root: self.indexes.clone(),
                    in_use,
                };
                tokio::task::spawn_blocking(move || {
                    native::prepare(&launch, session, channel, decoder, &place, transcript)
                })
                .await
                .map_err(|_| start_failed(request, "task_failed"))
                .and_then(|prepared| prepared.map_err(|error| native_failed(request, &error)))
                .map(|prepared| {
                    let initial = match &role {
                        Role::Lead { initial_delivery } | Role::Member { initial_delivery } => {
                            initial_delivery.clone()
                        }
                    };
                    prepared.start(
                        self.watch.clone(),
                        on_exit,
                        self.deliveries.clone(),
                        initial,
                    )
                })
            }
        };
        match started {
            Ok(handle) => {
                self.diagnostics.record(
                    "session.started",
                    &[
                        ("session", Field::Code(session.as_str())),
                        ("mode", Field::Code(launch.mode.code())),
                        ("channel", Field::Number(u64::from(channel))),
                    ],
                );
                let message = opened(request, &session, &workspace, &handle);
                match role {
                    Role::Lead { .. } => self.registry().insert(workspace, session, handle),
                    Role::Member { .. } => self.registry().insert_member(session, handle),
                }
                message
            }
            Err(failure) => failure,
        }
    }
}

impl<C: Core> Host<C> {
    /// The provider transcript of the workspace's session, read page by page, or `None` when it
    /// cannot be read whole within its bounds; the index then stays as it is.
    async fn transcript(&self, workspace: &str) -> Option<Vec<Input>> {
        let mut items = Vec::new();
        let mut bytes = 0;
        loop {
            let page = self
                .core
                .transcript(workspace, items.len() as u64, TRANSCRIPT_PAGE)
                .await
                .ok()?;
            let ended = page.complete || page.items.is_empty();
            for item in page.items {
                bytes += text_bytes(&item);
                items.push(item);
            }
            if items.len() > MAX_TRANSCRIPT_ITEMS || bytes > MAX_TRANSCRIPT_TEXT_BYTES {
                return None;
            }
            if ended {
                return Some(items);
            }
        }
    }
}

fn text_bytes(input: &Input) -> usize {
    match input {
        Input::Item {
            content:
                Content::UserMessage { text, .. }
                | Content::AgentMessage(text)
                | Content::Question(text),
            ..
        } => text.len(),
        _ => 0,
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

fn start_failed(request: &Identifier, reason: &str) -> HostMessage {
    messages::failed_with(
        request,
        RequestFailedMessageCode::SessionStartFailed,
        &[("reason", Some(reason))],
    )
}

/// A missing program means the provider's CLI is not installed; anything else is the system
/// refusing the PTY or the process.
fn pty_failed(request: &Identifier, error: &PtyError) -> HostMessage {
    match error {
        PtyError::Missing(_) => {
            messages::failed(request, RequestFailedMessageCode::ProviderCliUnavailable)
        }
        PtyError::Unavailable(_) => start_failed(request, "pty_unavailable"),
        PtyError::Spawn(_) => start_failed(request, "spawn_failed"),
        PtyError::Io(_) => start_failed(request, "io_failed"),
    }
}

fn native_failed(request: &Identifier, error: &StartError) -> HostMessage {
    match error {
        StartError::Process(StreamError::Spawn(error))
            if error.kind() == std::io::ErrorKind::NotFound =>
        {
            messages::failed(request, RequestFailedMessageCode::ProviderCliUnavailable)
        }
        StartError::Process(StreamError::Spawn(_)) => start_failed(request, "spawn_failed"),
        StartError::Process(_) => start_failed(request, "io_failed"),
        StartError::Index(_) | StartError::IndexDirectory(_) => {
            messages::failed(request, RequestFailedMessageCode::ConversationIndexCorrupt)
        }
    }
}
