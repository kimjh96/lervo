//! Ranges of the native conversation: stored items from the index thread and the open item from
//! memory.

use lervo_session_core::paging::page;
use lervo_session_core::ports::StreamDecoder;
use lervo_session_protocol::codec::decode_record;
use lervo_session_protocol::{ConversationItem, RequestFailedMessageCode};

use super::Native;
use crate::items::to_wire;
use crate::messages;
use crate::session::Range;

impl<D: StreamDecoder> Native<D> {
    /// Answers a range: stored items come from the index thread and the open item from memory.
    /// The answer waits on its own task, so the actor keeps serving the stream meanwhile.
    pub(super) fn range(&mut self, range: Range) {
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
