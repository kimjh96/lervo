//! Translation between the domain's conversation items and the protocol's.

use lervo_session_core::paging::item_id;
use lervo_session_core::transcript::{Content, Item, NoticeValue, ToolStatus};
use lervo_session_protocol::{
    AgentMessageItem, AgentMessageItemKind, AgentMessageItemState, AgentMessageItemText, Code,
    ConversationItem, EpochMilliseconds, Identifier, LervoNoticeItem, LervoNoticeItemKind,
    LervoNoticeItemState, Parameters, ParametersKey, ParametersValue, ParametersValueString,
    PeerMessageItem, PeerMessageItemFrom, PeerMessageItemKind, PeerMessageItemState,
    PeerMessageItemText, QuestionItem, QuestionItemKind, QuestionItemState, QuestionItemText,
    ToolActivityItem, ToolActivityItemKind, ToolActivityItemState, ToolActivityItemTool,
    ToolActivityItemToolName, ToolActivityItemToolStatus, UserMessageItem, UserMessageItemKind,
    UserMessageItemState, UserMessageItemText,
};

/// The code of the item that replaces one the provider adapter produced outside the protocol's
/// limits. It keeps every position filled, so the index and the live transcript never diverge.
pub const ITEM_INVALID: &str = "conversation_item_invalid";

/// The protocol item for `item`, or the `conversation_item_invalid` notice in its place. `None`
/// means even the notice failed to build, which the generated types make possible but the fixed
/// code and an `item_id` never cause; the caller then treats the index as damaged.
pub fn to_wire(item: &Item) -> Option<ConversationItem> {
    let id = item_id(item.position);
    convert(item, &id).or_else(|| {
        let item_id = Identifier::try_from(id.as_str()).ok()?;
        notice(
            item_id,
            EpochMilliseconds(item.created_at_ms),
            ITEM_INVALID,
            std::iter::empty(),
        )
    })
}

fn convert(item: &Item, id: &str) -> Option<ConversationItem> {
    let item_id = Identifier::try_from(id).ok()?;
    let created_at_ms = EpochMilliseconds(item.created_at_ms);
    let streaming = item.streaming;
    Some(match &item.content {
        Content::UserMessage(text) => ConversationItem::from(UserMessageItem {
            created_at_ms,
            item_id,
            kind: UserMessageItemKind::UserMessage,
            state: if streaming {
                UserMessageItemState::Streaming
            } else {
                UserMessageItemState::Complete
            },
            text: UserMessageItemText::try_from(text.as_str()).ok()?,
        }),
        Content::AgentMessage(text) => ConversationItem::from(AgentMessageItem {
            created_at_ms,
            item_id,
            kind: AgentMessageItemKind::AgentMessage,
            state: if streaming {
                AgentMessageItemState::Streaming
            } else {
                AgentMessageItemState::Complete
            },
            text: AgentMessageItemText::try_from(text.as_str()).ok()?,
        }),
        Content::Question(text) => ConversationItem::from(QuestionItem {
            created_at_ms,
            item_id,
            kind: QuestionItemKind::Question,
            state: if streaming {
                QuestionItemState::Streaming
            } else {
                QuestionItemState::Complete
            },
            text: QuestionItemText::try_from(text.as_str()).ok()?,
        }),
        Content::PeerMessage { from, text } => {
            if streaming {
                return None;
            }
            ConversationItem::from(PeerMessageItem {
                created_at_ms,
                item_id,
                kind: PeerMessageItemKind::PeerMessage,
                state: PeerMessageItemState::Complete,
                from: PeerMessageItemFrom::try_from(from.as_str()).ok()?,
                text: PeerMessageItemText::try_from(text.as_str()).ok()?,
            })
        }
        Content::ToolActivity {
            name,
            status,
            calls,
            detail,
        } => ConversationItem::from(ToolActivityItem {
            created_at_ms,
            item_id,
            kind: ToolActivityItemKind::ToolActivity,
            state: if streaming {
                ToolActivityItemState::Streaming
            } else {
                ToolActivityItemState::Complete
            },
            tool: ToolActivityItemTool {
                calls: std::num::NonZeroU64::new(*calls)?,
                // A detail outside the protocol is dropped; the line still shows the call.
                detail: detail
                    .as_deref()
                    .and_then(|json| serde_json::from_str(json).ok()),
                name: ToolActivityItemToolName::try_from(name.as_str()).ok()?,
                status: match status {
                    ToolStatus::Running => ToolActivityItemToolStatus::Running,
                    ToolStatus::Succeeded => ToolActivityItemToolStatus::Succeeded,
                    ToolStatus::Failed => ToolActivityItemToolStatus::Failed,
                },
            },
        }),
        Content::LervoNotice { code, parameters } => {
            if streaming {
                return None;
            }
            notice(item_id, created_at_ms, code, parameters.iter())?
        }
    })
}

fn notice<'a>(
    item_id: Identifier,
    created_at_ms: EpochMilliseconds,
    code: &str,
    parameters: impl ExactSizeIterator<Item = (&'a String, &'a NoticeValue)>,
) -> Option<ConversationItem> {
    if parameters.len() > 16 {
        return None;
    }
    let mut wire = std::collections::HashMap::new();
    for (name, value) in parameters {
        let value = match value {
            NoticeValue::Text(text) => {
                ParametersValue::String(ParametersValueString::try_from(text.as_str()).ok()?)
            }
            NoticeValue::Integer(number) => ParametersValue::Integer(*number),
            NoticeValue::Flag(flag) => ParametersValue::Boolean(*flag),
        };
        wire.insert(ParametersKey::try_from(name.as_str()).ok()?, value);
    }
    Some(ConversationItem::from(LervoNoticeItem {
        code: Code::try_from(code).ok()?,
        created_at_ms,
        item_id,
        kind: LervoNoticeItemKind::LervoNotice,
        parameters: Parameters(wire),
        state: LervoNoticeItemState::Complete,
    }))
}

#[cfg(test)]
mod tests {
    use lervo_session_core::transcript::{Content, Item, ToolStatus};
    use lervo_session_protocol::ConversationItem;

    use super::{ITEM_INVALID, to_wire};

    fn item(content: Content, streaming: bool) -> Item {
        Item {
            position: 26,
            created_at_ms: 5,
            content,
            streaming,
        }
    }

    #[test]
    fn translates_each_kind_with_its_position_identifier() {
        let Some(ConversationItem::AgentMessageItem(agent)) =
            to_wire(&item(Content::AgentMessage("Done.".to_owned()), true))
        else {
            panic!("expected an agent message");
        };
        assert_eq!(
            (agent.item_id.as_str(), agent.text.as_str()),
            ("i1a", "Done.")
        );
        assert_eq!(serde_json::to_value(agent.state).unwrap(), "streaming");
        let tool = Content::ToolActivity {
            name: "Edit".to_owned(),
            status: ToolStatus::Succeeded,
            calls: 3,
            detail: None,
        };
        assert!(matches!(
            to_wire(&item(tool, false)),
            Some(ConversationItem::ToolActivityItem(_))
        ));
    }

    #[test]
    fn sends_a_tool_detail_within_the_protocol_and_drops_one_outside_it() {
        let tool = |detail: &str| Content::ToolActivity {
            name: "Edit".to_owned(),
            status: ToolStatus::Succeeded,
            calls: 1,
            detail: Some(detail.to_owned()),
        };
        let valid = r#"{"subject":{"kind":"path","text":"src/login.ts"},"counts":{"added":1,"removed":1},"lervo":{"command":"knowledge query","subject":"limits"},"preview":{"format":"diff","lines":["-a","+b"],"omittedLines":0,"omittedAt":2}}"#;
        let Some(ConversationItem::ToolActivityItem(sent)) = to_wire(&item(tool(valid), false))
        else {
            panic!("expected a tool line");
        };
        let detail = serde_json::to_value(sent.tool.detail).unwrap();
        assert_eq!(detail["subject"]["text"], "src/login.ts");
        assert_eq!(detail["preview"]["lines"][1], "+b");
        assert_eq!(detail["lervo"]["command"], "knowledge query");
        for invalid in [
            r#"{"subject":{"kind":"path","text":""}}"#,
            r#"{"counts":{}}"#,
            r#"{"subject":{"kind":"command","text":"lervo x"},"lervo":{"command":"Knowledge Query"}}"#,
            "not json",
        ] {
            let Some(ConversationItem::ToolActivityItem(sent)) =
                to_wire(&item(tool(invalid), false))
            else {
                panic!("expected a tool line");
            };
            assert!(sent.tool.detail.is_none(), "{invalid}");
        }
    }

    #[test]
    fn replaces_an_item_outside_the_protocol_limits_with_a_notice() {
        let unnamed = Content::ToolActivity {
            name: String::new(),
            status: ToolStatus::Running,
            calls: 1,
            detail: None,
        };
        let Some(ConversationItem::LervoNoticeItem(notice)) = to_wire(&item(unnamed, false)) else {
            panic!("expected the replacement notice");
        };
        assert_eq!(
            (notice.code.as_str(), notice.item_id.as_str()),
            (ITEM_INVALID, "i1a")
        );
    }
}
