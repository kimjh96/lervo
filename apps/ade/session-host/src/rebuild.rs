//! Rebuilding a native conversation's index from the provider's own transcript, the canonical
//! conversation (invariant 4): turns from the CLI conversation, which leaves no items in the
//! index, appear in the native conversation, and a damaged index heals.

use std::path::Path;

use lervo_session_core::transcript::{Change, Input, Item, Transcript};
use lervo_session_protocol::codec::encode;
use lervo_session_store::{ConversationStore, StoreError, retention};

use crate::items::to_wire;

/// The items `transcript` places, as the live transcript would: long text splits the same way.
pub(crate) fn projected(transcript: Vec<Input>) -> Vec<Item> {
    let mut projection = Transcript::new(0);
    let mut items = Vec::new();
    for input in transcript {
        for change in projection.apply(input) {
            if let Change::Appended(item) | Change::Completed(item) = change
                && !item.streaming
            {
                items.push(item);
            }
        }
    }
    items
}

/// Opens the index in `directory`. With transcript `items` that differ in number from what the
/// index holds, it replaces the index with them; an empty transcript, such as one the provider did
/// not keep, never replaces anything.
pub(crate) fn open_synced(
    directory: &Path,
    cache_bytes: usize,
    items: Option<Vec<Item>>,
) -> Result<ConversationStore, StoreError> {
    let store = ConversationStore::open(directory, cache_bytes)?;
    let Some(items) = items else {
        return Ok(store);
    };
    if items.is_empty() || store.len() == items.len() as u64 {
        return Ok(store);
    }
    drop(store);
    lervo_session_store::remove(directory)?;
    retention::touch(directory)?;
    let mut store = ConversationStore::open(directory, cache_bytes)?;
    for item in &items {
        // An item that cannot be encoded ends the rebuild; the items before it stay.
        let Some(record) = to_wire(item).and_then(|wire| encode(&wire).ok()) else {
            break;
        };
        store.append(&record)?;
    }
    Ok(store)
}

#[cfg(test)]
mod tests {
    use lervo_session_core::transcript::{Content, Input};
    use lervo_session_store::ConversationStore;

    use super::{open_synced, projected};

    fn said(text: &str, at: u64) -> Input {
        Input::Item {
            content: Content::UserMessage(text.to_owned()),
            created_at_ms: at,
        }
    }

    #[test]
    fn replaces_an_index_that_differs_from_the_transcript_and_keeps_one_that_matches() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("ses_1");
        let mut store = ConversationStore::open(&path, 1024).unwrap();
        store.append(b"native only").unwrap();
        drop(store);

        let transcript = vec![
            said("from the terminal", 1),
            said("and the conversation", 2),
        ];
        let store = open_synced(&path, 1024, Some(projected(transcript.clone()))).unwrap();
        assert_eq!(store.len(), 2);
        drop(store);

        let store = open_synced(&path, 1024, Some(projected(transcript))).unwrap();
        assert_eq!(store.len(), 2);
        drop(store);

        let store = open_synced(&path, 1024, Some(Vec::new())).unwrap();
        assert_eq!(store.len(), 2);
    }
}
