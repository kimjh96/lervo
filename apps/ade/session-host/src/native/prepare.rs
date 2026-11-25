//! Starting a native session: its index opened under the cap on all indexes, rebuilt from the
//! provider's transcript when needed, and its provider process spawned, before its actor runs.

use std::path::PathBuf;

use lervo_session_core::ports::{ConversationMode, Launch, SentImage, StreamDecoder};
use lervo_session_core::retention::INDEX_CAP_BYTES;
use lervo_session_core::transcript::{Input, Transcript};
use lervo_session_protocol::Identifier;
use lervo_session_store::{StoreError, retention};
use lervo_session_stream::{StreamCommand, StreamError, StreamProcess};

use super::{ExitReport, Native};
use crate::index::Index;
use crate::rebuild;
use crate::session::{Fanout, SessionHandle, StatusSink};

/// Bytes of sealed segments one session keeps in memory.
const SEGMENT_CACHE_BYTES: usize = 1024 * 1024;
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
    initial_images: Vec<SentImage>,
    directory: PathBuf,
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
        initial_images: launch.initial_images.clone(),
        directory,
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
            initial_images: self.initial_images,
            directory: self.directory,
            transcript: Transcript::new(self.stored),
            index: self.index,
            decoder: self.decoder,
            on_exit: Some(on_exit),
        };
        tokio::spawn(actor.run(self.process, commands));
        handle
    }
}
