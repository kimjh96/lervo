//! Translation from the core link's decoded events and launches to the domain's types.

use std::collections::BTreeMap;
use std::path::PathBuf;

use lervo_session_core::ports::{ConversationMode, Decoded, Launch, RoomDelivery};
use lervo_session_core::status::SessionEvent;
use lervo_session_core::transcript::{
    Content, Input, MAX_IMAGE_MARKS_BYTES, MAX_TOOL_DETAIL_BYTES, NoticeValue, ToolStatus,
};
use lervo_session_protocol::core_link::{
    ConversationMode as WireMode, CoreLaunch, DecodedContent, DecodedEvent, DecodedStatusEvent,
    ParametersValue, RoomDelivery as WireDelivery, ToolActivityContentStatus,
    TranscriptPageResponseItemsItem,
};

/// A turn the core asks the session host to give another agent of the conversation. The
/// session that decoded it fills in itself as the source.
pub fn delivery(delivery: WireDelivery) -> Decoded {
    Decoded::Delivery(RoomDelivery {
        delivery_id: delivery.delivery_id.to_string(),
        workspace_id: delivery.workspace_id.to_string(),
        agent_id: delivery.agent_id.to_string(),
        session_id: delivery.session_id.map(|session| session.to_string()),
        source_session_id: None,
        text: delivery.text.to_string(),
    })
}

pub fn decoded(event: DecodedEvent) -> Decoded {
    match event {
        DecodedEvent::Status(status) => Decoded::Status(match status.event {
            DecodedStatusEvent::TurnStarted => SessionEvent::TurnStarted,
            DecodedStatusEvent::QuestionAsked => SessionEvent::QuestionAsked,
            DecodedStatusEvent::TurnFinished => SessionEvent::TurnFinished,
        }),
        DecodedEvent::Item(item) => Decoded::Conversation(Input::Item {
            content: content(item.content),
            created_at_ms: item.created_at_ms.0,
        }),
        DecodedEvent::Start(start) => Decoded::Conversation(Input::Start {
            content: content(start.content),
            created_at_ms: start.created_at_ms.0,
        }),
        DecodedEvent::Delta(delta) => Decoded::Conversation(Input::Delta(delta.text.to_string())),
        DecodedEvent::Finish(_) => Decoded::Conversation(Input::Finish),
    }
}

fn content(content: DecodedContent) -> Content {
    match content {
        DecodedContent::UserMessageContent(item) => Content::UserMessage {
            text: item.text.to_string(),
            // Marks that cannot be written, or are too large, are dropped; the message stays.
            images: Some(item.images)
                .filter(|images| !images.is_empty())
                .and_then(|images| serde_json::to_string(&images).ok())
                .filter(|json| json.len() <= MAX_IMAGE_MARKS_BYTES),
        },
        DecodedContent::AgentMessageContent(item) => Content::AgentMessage(item.text.to_string()),
        DecodedContent::QuestionContent(item) => Content::Question(item.text.to_string()),
        DecodedContent::PeerMessageContent(item) => Content::PeerMessage {
            from: item.from.to_string(),
            text: item.text.to_string(),
        },
        DecodedContent::ToolActivityContent(item) => Content::ToolActivity {
            name: item.name.to_string(),
            status: match item.status {
                ToolActivityContentStatus::Running => ToolStatus::Running,
                ToolActivityContentStatus::Succeeded => ToolStatus::Succeeded,
                ToolActivityContentStatus::Failed => ToolStatus::Failed,
            },
            calls: item.calls.get(),
            // A detail that cannot be written, or is too large, is dropped; the line stays.
            detail: item
                .detail
                .and_then(|detail| serde_json::to_string(&detail).ok())
                .filter(|json| json.len() <= MAX_TOOL_DETAIL_BYTES),
        },
        DecodedContent::LervoNoticeContent(item) => Content::LervoNotice {
            code: item.code.to_string(),
            parameters: item
                .parameters
                .0
                .into_iter()
                .map(|(name, value)| {
                    let value = match value {
                        ParametersValue::String(text) => NoticeValue::Text(text.to_string()),
                        ParametersValue::Integer(number) => NoticeValue::Integer(number),
                        ParametersValue::Boolean(flag) => NoticeValue::Flag(flag),
                    };
                    (name.to_string(), value)
                })
                .collect::<BTreeMap<_, _>>(),
        },
    }
}

pub fn launch(launch: CoreLaunch) -> Launch {
    Launch {
        session_id: launch.session_id.to_string(),
        workspace_id: launch.workspace_id.to_string(),
        mode: match launch.conversation_mode {
            WireMode::Native => ConversationMode::Native,
            WireMode::Cli => ConversationMode::Cli,
        },
        provider: launch.provider.to_string(),
        program: launch.program.to_string(),
        arguments: launch
            .arguments
            .into_iter()
            .map(|item| item.to_string())
            .collect(),
        environment: launch
            .environment
            .into_iter()
            .map(|(name, value)| (name, value.to_string()))
            .collect(),
        working_directory: PathBuf::from(launch.working_directory.to_string()),
        initial_input: launch.initial_input.map(|text| text.to_string()),
        initial_images: Vec::new(),
        environment_remove: launch
            .environment_remove
            .into_iter()
            .map(|name| name.to_string())
            .collect(),
        transcript: launch.transcript.unwrap_or(false),
    }
}

/// A complete transcript item as the input the session host's transcript applies.
pub fn transcript_item(item: TranscriptPageResponseItemsItem) -> Input {
    Input::Item {
        content: content(item.content),
        created_at_ms: item.created_at_ms.0,
    }
}

#[cfg(test)]
mod tests {
    use lervo_session_core::transcript::{Content, Input};
    use lervo_session_protocol::core_link::DecodedEvent;
    use serde_json::json;

    use super::decoded;
    use lervo_session_core::ports::Decoded;

    fn detail_of(detail: serde_json::Value) -> Option<String> {
        let event: DecodedEvent = serde_json::from_value(json!({
            "kind": "item",
            "createdAtMs": 1,
            "content": {
                "kind": "tool_activity", "name": "Bash", "status": "succeeded", "calls": 1,
                "detail": detail,
            },
        }))
        .unwrap();
        let Decoded::Conversation(Input::Item {
            content: Content::ToolActivity { detail, .. },
            ..
        }) = decoded(event)
        else {
            panic!("expected a tool item");
        };
        detail
    }

    #[test]
    fn keeps_a_tool_detail_as_json_and_drops_one_beyond_its_bound() {
        let kept = detail_of(json!({ "subject": { "kind": "command", "text": "pnpm test" } }));
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&kept.unwrap()).unwrap()["subject"]["text"],
            "pnpm test"
        );
        // 24 lines of 240 three-byte characters exceed `MAX_TOOL_DETAIL_BYTES`, which the
        // adapters keep far within.
        let line = "가".repeat(240);
        let large = detail_of(json!({
            "subject": { "kind": "command", "text": "cat wide.log" },
            "preview": {
                "format": "output", "lines": vec![line; 24], "omittedLines": 0, "omittedAt": 24,
            },
        }));
        assert!(large.is_none());
    }
}
