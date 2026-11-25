//! What a conversation item holds (sessions specification, "Conversation index"), with the bounds
//! on the protocol JSON it keeps for tool details and image marks.

use std::collections::BTreeMap;

/// Bytes of one tool call's serialized detail. Adapters keep a detail far smaller; a larger one
/// is dropped, so a page of tool lines stays well within one frame.
pub const MAX_TOOL_DETAIL_BYTES: usize = 6 * 1024;
/// Bytes of one user message's serialized image marks: a format and a size for each of at most
/// three images. A larger value is dropped, and the message stays.
pub const MAX_IMAGE_MARKS_BYTES: usize = 512;

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

/// What an item holds. Tool activity holds its bounded detail, and a user message the marks of its
/// images, as the protocol's JSON, which the session host checks against the protocol when it
/// sends the item.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Content {
    UserMessage {
        text: String,
        images: Option<String>,
    },
    AgentMessage(String),
    Question(String),
    /// A message another agent session sent: the sender's name and the text.
    PeerMessage {
        from: String,
        text: String,
    },
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
    pub(crate) fn text_mut(&mut self) -> Option<&mut String> {
        match self {
            Self::UserMessage { text, .. } | Self::AgentMessage(text) | Self::Question(text) => {
                Some(text)
            }
            Self::ToolActivity { .. } | Self::LervoNotice { .. } | Self::PeerMessage { .. } => None,
        }
    }

    pub(crate) fn with_text(&self, text: String) -> Self {
        match self {
            Self::UserMessage { images, .. } => Self::UserMessage {
                text,
                images: images.clone(),
            },
            Self::Question(_) => Self::Question(text),
            _ => Self::AgentMessage(text),
        }
    }
}
