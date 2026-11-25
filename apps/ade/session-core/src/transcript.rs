//! The live end of a native conversation (sessions specification, "Conversation index").
//!
//! Stored items are immutable. At most one item streams at a time; it stays in memory until it
//! completes and is then stored at the position it was given when it started.

use std::collections::BTreeMap;

/// Bytes of text in one item. The protocol allows 262,144 characters; bytes bound characters.
pub const MAX_ITEM_TEXT_BYTES: usize = 256 * 1024;
/// Bytes of text in one delta. The protocol allows 65,536 characters.
pub const MAX_DELTA_BYTES: usize = 64 * 1024;
/// Bytes of one tool call's serialized detail. Adapters keep a detail far smaller; a larger one
/// is dropped, so a page of tool lines stays well within one frame.
pub const MAX_TOOL_DETAIL_BYTES: usize = 6 * 1024;

/// A tool call's status.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolStatus {
    Running,
    Succeeded,
    Failed,
}

/// A Lervo notice parameter.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NoticeValue {
    Text(String),
    Integer(i64),
    Flag(bool),
}

/// What an item holds. Tool activity holds its bounded detail as the protocol's JSON, which the
/// session host checks against the protocol when it sends the item.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Content {
    UserMessage(String),
    AgentMessage(String),
    Question(String),
    ToolActivity {
        name: String,
        status: ToolStatus,
        calls: u64,
        detail: Option<String>,
    },
    LervoNotice {
        code: String,
        parameters: BTreeMap<String, NoticeValue>,
    },
}

impl Content {
    fn text_mut(&mut self) -> Option<&mut String> {
        match self {
            Self::UserMessage(text) | Self::AgentMessage(text) | Self::Question(text) => Some(text),
            Self::ToolActivity { .. } | Self::LervoNotice { .. } => None,
        }
    }

    fn with_text(&self, text: String) -> Self {
        match self {
            Self::UserMessage(_) => Self::UserMessage(text),
            Self::Question(_) => Self::Question(text),
            _ => Self::AgentMessage(text),
        }
    }
}

/// A conversation item at its position.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Item {
    pub position: u64,
    pub created_at_ms: u64,
    pub content: Content,
    pub streaming: bool,
}

/// What the provider adapter decoded.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Input {
    /// A complete item.
    Item {
        content: Content,
        created_at_ms: u64,
    },
    /// An item whose text streams in.
    Start {
        content: Content,
        created_at_ms: u64,
    },
    /// More text for the streaming item.
    Delta(String),
    /// The streaming item is complete.
    Finish,
}

/// What the session host does with an input.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Change {
    /// Send `conversation.appended`. A complete item is also stored.
    Appended(Item),
    /// Send `conversation.delta` for the streaming item.
    Delta { position: u64, text: String },
    /// The streaming item completed: store it.
    Completed(Item),
}

/// The live end of one conversation.
#[derive(Debug)]
pub struct Transcript {
    next_position: u64,
    open: Option<Item>,
}

impl Transcript {
    /// A transcript after `stored` items.
    pub fn new(stored: u64) -> Self {
        Self {
            next_position: stored,
            open: None,
        }
    }

    /// Items stored or streaming.
    pub fn len(&self) -> u64 {
        self.next_position
    }

    pub fn is_empty(&self) -> bool {
        self.next_position == 0
    }

    /// The streaming item, if one is open.
    pub fn open(&self) -> Option<&Item> {
        self.open.as_ref()
    }

    /// Applies one decoded input. A new item completes the streaming one first. Text beyond the
    /// item limit continues in a new item of the same kind, and long deltas split into parts.
    pub fn apply(&mut self, input: Input) -> Vec<Change> {
        let mut changes = Vec::new();
        match input {
            Input::Item {
                content,
                created_at_ms,
            } => {
                self.finish(&mut changes);
                let item = self.place(content, created_at_ms, false);
                changes.push(Change::Appended(item));
            }
            Input::Start {
                content,
                created_at_ms,
            } => {
                self.finish(&mut changes);
                let item = self.place(content, created_at_ms, true);
                changes.push(Change::Appended(item.clone()));
                self.open = Some(item);
            }
            Input::Delta(text) => self.append(&text, &mut changes),
            Input::Finish => self.finish(&mut changes),
        }
        changes
    }

    fn place(&mut self, content: Content, created_at_ms: u64, streaming: bool) -> Item {
        let item = Item {
            position: self.next_position,
            created_at_ms,
            content,
            streaming,
        };
        self.next_position += 1;
        item
    }

    fn append(&mut self, mut text: &str, changes: &mut Vec<Change>) {
        while !text.is_empty() {
            let Some(open) = self.open.as_mut() else {
                return;
            };
            let Some(current) = open.content.text_mut() else {
                return;
            };
            let room = MAX_ITEM_TEXT_BYTES.saturating_sub(current.len());
            let part = prefix(text, room.min(MAX_DELTA_BYTES));
            if part.is_empty() {
                // The item is full, or its last bytes cannot hold the next character.
                let created_at_ms = open.created_at_ms;
                let next = open.content.with_text(String::new());
                self.finish(changes);
                let item = self.place(next, created_at_ms, true);
                changes.push(Change::Appended(item.clone()));
                self.open = Some(item);
                continue;
            }
            current.push_str(part);
            changes.push(Change::Delta {
                position: open.position,
                text: part.to_owned(),
            });
            text = &text[part.len()..];
        }
    }

    fn finish(&mut self, changes: &mut Vec<Change>) {
        if let Some(mut item) = self.open.take() {
            item.streaming = false;
            changes.push(Change::Completed(item));
        }
    }
}

/// Merges consecutive deltas of the same item into one, each at most `MAX_DELTA_BYTES`, so a fast
/// stream sends fewer messages. Every other change keeps its place.
pub fn coalesce(changes: Vec<Change>) -> Vec<Change> {
    let mut merged: Vec<Change> = Vec::with_capacity(changes.len());
    for change in changes {
        if let (
            Some(Change::Delta {
                position: last_position,
                text: last_text,
            }),
            Change::Delta { position, text },
        ) = (merged.last_mut(), &change)
            && last_position == position
            && last_text.len() + text.len() <= MAX_DELTA_BYTES
        {
            last_text.push_str(text);
            continue;
        }
        merged.push(change);
    }
    merged
}

/// The longest prefix of `text` within `bytes` that ends on a character boundary. It is empty
/// only when `bytes` cannot hold the first character.
fn prefix(text: &str, bytes: usize) -> &str {
    let mut end = bytes.min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

#[cfg(test)]
mod tests {
    use super::{
        Change, Content, Input, Item, MAX_DELTA_BYTES, MAX_ITEM_TEXT_BYTES, Transcript, coalesce,
    };

    fn agent(text: &str) -> Input {
        Input::Start {
            content: Content::AgentMessage(text.to_owned()),
            created_at_ms: 1,
        }
    }

    #[test]
    fn streams_an_item_and_stores_it_when_it_completes() {
        let mut transcript = Transcript::new(3);
        assert!(matches!(
            &transcript.apply(agent(""))[..],
            [Change::Appended(Item {
                position: 3,
                streaming: true,
                ..
            })]
        ));
        assert_eq!(
            transcript.apply(Input::Delta("Hel".to_owned())),
            vec![Change::Delta {
                position: 3,
                text: "Hel".to_owned()
            }]
        );
        transcript.apply(Input::Delta("lo".to_owned()));
        let [Change::Completed(item)] = &transcript.apply(Input::Finish)[..] else {
            panic!("expected one completed item");
        };
        assert_eq!(
            (item.position, &item.content, item.streaming),
            (3, &Content::AgentMessage("Hello".to_owned()), false)
        );
        assert_eq!(transcript.len(), 4);
        assert!(transcript.open().is_none());
    }

    #[test]
    fn completes_the_streaming_item_before_a_new_one() {
        let mut transcript = Transcript::new(0);
        transcript.apply(agent("a"));
        let changes = transcript.apply(Input::Item {
            content: Content::Question("Which branch?".to_owned()),
            created_at_ms: 2,
        });
        assert!(matches!(
            &changes[..],
            [
                Change::Completed(Item { position: 0, .. }),
                Change::Appended(Item {
                    position: 1,
                    streaming: false,
                    ..
                })
            ]
        ));
    }

    #[test]
    fn ignores_text_without_a_streaming_item() {
        let mut transcript = Transcript::new(0);
        assert!(transcript.apply(Input::Delta("lost".to_owned())).is_empty());
        assert!(transcript.apply(Input::Finish).is_empty());
    }

    #[test]
    fn splits_long_text_into_deltas_and_items_within_the_limits() {
        let mut transcript = Transcript::new(0);
        transcript.apply(agent(""));
        let text = "é".repeat(MAX_ITEM_TEXT_BYTES);
        let changes = transcript.apply(Input::Delta(text.clone()));
        let mut rebuilt = String::new();
        for change in &changes {
            if let Change::Delta { text, .. } = change {
                assert!(text.len() <= MAX_DELTA_BYTES);
                rebuilt.push_str(text);
            }
            if let Change::Completed(Item {
                content: Content::AgentMessage(text),
                ..
            }) = change
            {
                assert!(text.len() <= MAX_ITEM_TEXT_BYTES);
            }
        }
        assert_eq!(rebuilt, text);
        assert!(
            changes
                .iter()
                .any(|change| matches!(change, Change::Appended(Item { position: 1, .. })))
        );
        assert_eq!(transcript.len(), 2);
    }

    #[test]
    fn continues_in_a_new_item_when_a_character_does_not_fit() {
        let mut transcript = Transcript::new(0);
        transcript.apply(agent(""));
        transcript.apply(Input::Delta("a".repeat(MAX_ITEM_TEXT_BYTES - 1)));
        let changes = transcript.apply(Input::Delta("é".to_owned()));
        assert!(matches!(
            &changes[..],
            [
                Change::Completed(Item { position: 0, .. }),
                Change::Appended(Item { position: 1, .. }),
                Change::Delta { position: 1, .. }
            ]
        ));
    }

    #[test]
    fn merges_consecutive_deltas_of_one_item_within_the_limit() {
        let delta = |position: u64, text: &str| Change::Delta {
            position,
            text: text.to_owned(),
        };
        let big = "x".repeat(MAX_DELTA_BYTES - 1);
        let merged = coalesce(vec![
            delta(1, "a"),
            delta(1, "b"),
            delta(2, "c"),
            delta(2, &big),
            delta(2, "d"),
        ]);
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0], delta(1, "ab"));
        assert!(
            matches!(&merged[1], Change::Delta { position: 2, text } if text.len() == MAX_DELTA_BYTES)
        );
        assert_eq!(merged[2], delta(2, "d"));
    }
}
