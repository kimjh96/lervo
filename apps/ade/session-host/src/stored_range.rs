//! Ranges of a conversation whose session does not run, read from the index it left (ADE
//! sessions, "Reopening a conversation"). A conversation then shows its newest page while its
//! session starts, rather than after.

use std::path::{Path, PathBuf};

use lervo_session_core::paging::{Direction, page};
use lervo_session_protocol::codec::decode_record;
use lervo_session_protocol::{ConversationItem, Identifier, RequestFailedMessageCode};
use lervo_session_store::ConversationStore;

use crate::messages;
use crate::session::Reply;

/// One range a stopped session's index answers.
pub(crate) struct StoredRange {
    pub(crate) request: Identifier,
    pub(crate) session: Identifier,
    pub(crate) anchor: Option<String>,
    pub(crate) direction: Direction,
    pub(crate) limit: u64,
}

/// Answers `range` from the index in `directory` off the async workers. An index that is missing,
/// damaged, or being rebuilt by a session that starts answers as no session would:
/// `session_not_found`, which the interface already handles by opening the session.
pub(crate) fn answer(directory: PathBuf, range: StoredRange, reply: Reply) {
    tokio::spawn(async move {
        let StoredRange {
            request,
            session,
            anchor,
            direction,
            limit,
        } = range;
        let read = tokio::task::spawn_blocking(move || {
            read(&directory, anchor.as_deref(), direction, limit)
        })
        .await
        .ok()
        .flatten();
        reply.send(match read {
            Some((items, has_earlier, has_later)) => {
                messages::stored_page(&request, &session, items, has_earlier, has_later)
            }
            None => messages::failed(&request, RequestFailedMessageCode::SessionNotFound),
        });
    });
}

/// The page's items and whether items lie before and after it, or `None` when the index cannot
/// answer.
fn read(
    directory: &Path,
    anchor: Option<&str>,
    direction: Direction,
    limit: u64,
) -> Option<(Vec<ConversationItem>, bool, bool)> {
    // Each read opens the index anew, so nothing is cached for a session that is not running.
    let mut store = ConversationStore::open_read_only(directory, 0).ok()??;
    let page = page(store.len(), anchor, direction, limit).ok()?;
    let items = store
        .read(page.start, page.end)
        .ok()?
        .iter()
        .map(|record| decode_record::<ConversationItem>(record).ok())
        .collect::<Option<Vec<_>>>()?;
    Some((items, page.has_earlier, page.has_later))
}
