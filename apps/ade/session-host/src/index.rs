//! A native session's conversation index on its own thread. Storing and reading segments is
//! synchronous file I/O, so it never runs on an async worker (ADE performance, "CPU"). The actor
//! queues appends without waiting and asks for ranges with a reply.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use lervo_session_store::ConversationStore;
use tokio::sync::{mpsc, oneshot};

/// Bytes of appends that may wait for the disk; beyond this the index is damaged, live items keep
/// flowing, and ranges report `conversation_index_corrupt`.
const QUEUED_APPEND_BYTES: usize = 16 * 1024 * 1024;

enum Request {
    Append {
        position: u64,
        record: Vec<u8>,
    },
    Read {
        start: u64,
        end: u64,
        reply: oneshot::Sender<Option<Vec<Vec<u8>>>>,
    },
}

/// The actor's side of the index thread.
pub(crate) struct Index {
    requests: mpsc::UnboundedSender<Request>,
    queued: Arc<AtomicUsize>,
    damaged: bool,
}

impl Index {
    /// Moves `store` to a new thread that serves this index until the actor drops it.
    pub(crate) fn spawn(store: ConversationStore) -> std::io::Result<Self> {
        let (requests, receiver) = mpsc::unbounded_channel();
        let queued = Arc::new(AtomicUsize::new(0));
        let draining = Arc::clone(&queued);
        std::thread::Builder::new()
            .name("lervo-conversation-index".to_owned())
            .spawn(move || serve(store, receiver, &draining))?;
        Ok(Self {
            requests,
            queued,
            damaged: false,
        })
    }

    /// Queues a complete item's record at `position`. A record out of order, a failed write, or
    /// a disk too far behind damages the index for good.
    pub(crate) fn append(&mut self, position: u64, record: Vec<u8>) {
        if self.damaged {
            return;
        }
        let bytes = record.len();
        if self.queued.fetch_add(bytes, Ordering::AcqRel) + bytes > QUEUED_APPEND_BYTES
            || self
                .requests
                .send(Request::Append { position, record })
                .is_err()
        {
            self.damage();
        }
    }

    /// Marks the index damaged, so later appends stop and reads fail.
    pub(crate) fn damage(&mut self) {
        self.damaged = true;
    }

    /// The stored records `[start, end)`, after every append queued before, or `None` when the
    /// index is damaged.
    pub(crate) fn read(&self, start: u64, end: u64) -> oneshot::Receiver<Option<Vec<Vec<u8>>>> {
        let (reply, answer) = oneshot::channel();
        if self.damaged {
            let _ = reply.send(None);
        } else if let Err(mpsc::error::SendError(Request::Read { reply, .. })) =
            self.requests.send(Request::Read { start, end, reply })
        {
            let _ = reply.send(None);
        }
        answer
    }
}

fn serve(
    mut store: ConversationStore,
    mut requests: mpsc::UnboundedReceiver<Request>,
    queued: &AtomicUsize,
) {
    let mut damaged = false;
    while let Some(request) = requests.blocking_recv() {
        match request {
            Request::Append { position, record } => {
                queued.fetch_sub(record.len(), Ordering::AcqRel);
                if !damaged {
                    damaged = store.len() != position || store.append(&record).is_err();
                }
            }
            Request::Read { start, end, reply } => {
                let stored_end = end.min(store.len());
                let records = if damaged {
                    None
                } else if start >= stored_end {
                    Some(Vec::new())
                } else {
                    store.read(start, stored_end).ok()
                };
                let _ = reply.send(records);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use lervo_session_store::ConversationStore;

    use super::Index;

    #[tokio::test]
    async fn reads_what_was_appended_before_and_reports_damage() {
        let directory = tempfile::tempdir().unwrap();
        let store = ConversationStore::open(directory.path().join("ses_1"), 1024).unwrap();
        let mut index = Index::spawn(store).unwrap();
        index.append(0, b"first".to_vec());
        index.append(1, b"second".to_vec());
        let records = index.read(0, 5).await.unwrap().unwrap();
        assert_eq!(records, [b"first".to_vec(), b"second".to_vec()]);
        assert_eq!(
            index.read(2, 5).await.unwrap().unwrap(),
            Vec::<Vec<u8>>::new()
        );
        // An item out of order damages the index on its thread; reads then fail.
        index.append(5, b"gap".to_vec());
        assert_eq!(index.read(0, 2).await.unwrap(), None);
    }
}
