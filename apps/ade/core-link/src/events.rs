//! Translation from the core link's decoded events and launches to the domain's types.

use std::collections::BTreeMap;
use std::path::PathBuf;

use lervo_session_core::ports::{ConversationMode, Decoded, Launch};
use lervo_session_core::status::SessionEvent;
use lervo_session_core::transcript::{Content, Input, NoticeValue, ToolStatus};
use lervo_session_protocol::core_link::{
    ConversationMode as WireMode, CoreLaunch, DecodedContent, DecodedEvent, DecodedStatusEvent,
    ParametersValue, ToolActivityContentStatus,
};

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
        DecodedContent::UserMessageContent(item) => Content::UserMessage(item.text.to_string()),
        DecodedContent::AgentMessageContent(item) => Content::AgentMessage(item.text.to_string()),
        DecodedContent::QuestionContent(item) => Content::Question(item.text.to_string()),
        DecodedContent::ToolActivityContent(item) => Content::ToolActivity {
            name: item.name.to_string(),
            status: match item.status {
                ToolActivityContentStatus::Running => ToolStatus::Running,
                ToolActivityContentStatus::Succeeded => ToolStatus::Succeeded,
                ToolActivityContentStatus::Failed => ToolStatus::Failed,
            },
            calls: item.calls.get(),
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
    }
}
