//! Builders for the host messages the session host sends.

use std::num::NonZeroU64;

use lervo_session_core::status::{EndReason, SessionStatus};
use lervo_session_protocol::{
    ApplicationResultMessage, ApplicationResultMessageKind, ConversationAppendedMessage,
    ConversationAppendedMessageKind, ConversationDeltaMessage, ConversationDeltaMessageAppend,
    ConversationDeltaMessageKind, ConversationItem, ConversationMode as WireMode,
    ConversationPageMessage, ConversationPageMessageKind, HostMessage, Identifier, Parameters,
    ParametersKey, ParametersValue, ParametersValueString, RequestFailedMessage,
    RequestFailedMessageCode, RequestFailedMessageKind, Sequence, SessionOpenedMessage,
    SessionOpenedMessageKind, SessionResyncRequiredMessage, SessionResyncRequiredMessageKind,
    SessionSentMessage, SessionSentMessageKind, SessionStatusMessage,
    SessionStatusMessageEndReason, SessionStatusMessageKind, SessionStatusMessageStatus,
};
use serde_json::{Map, Value};

use lervo_session_core::ports::{ConversationMode, Failure, FailureCode};

/// An identifier from a string the host or the core produced, or `None` if it breaks the format.
pub fn identifier(value: &str) -> Option<Identifier> {
    Identifier::try_from(value).ok()
}

pub fn status(session: &Identifier, sequence: NonZeroU64, status: SessionStatus) -> HostMessage {
    let (status, end_reason) = match status {
        SessionStatus::Starting => (SessionStatusMessageStatus::Starting, None),
        SessionStatus::Working => (SessionStatusMessageStatus::Working, None),
        SessionStatus::NeedsUser => (SessionStatusMessageStatus::NeedsUser, None),
        SessionStatus::Idle => (SessionStatusMessageStatus::Idle, None),
        SessionStatus::Ended(reason) => (
            SessionStatusMessageStatus::Ended,
            Some(match reason {
                EndReason::Completed => SessionStatusMessageEndReason::Completed,
                EndReason::Stopped => SessionStatusMessageEndReason::Stopped,
                EndReason::Failed => SessionStatusMessageEndReason::Failed,
                EndReason::ProviderExited => SessionStatusMessageEndReason::ProviderExited,
            }),
        ),
    };
    HostMessage::from(SessionStatusMessage {
        end_reason,
        kind: SessionStatusMessageKind::SessionStatus,
        sequence: Sequence(sequence),
        session_id: session.clone(),
        status,
    })
}

/// The protocol's conversation mode for the domain's; the only place the session host maps it.
pub fn wire_mode(mode: ConversationMode) -> WireMode {
    match mode {
        ConversationMode::Native => WireMode::Native,
        ConversationMode::Cli => WireMode::Cli,
    }
}

/// The domain's conversation mode for the protocol's.
pub fn domain_mode(mode: WireMode) -> ConversationMode {
    match mode {
        WireMode::Native => ConversationMode::Native,
        WireMode::Cli => ConversationMode::Cli,
    }
}

pub fn opened(
    request: &Identifier,
    session: &Identifier,
    workspace: &Identifier,
    mode: ConversationMode,
    channel: NonZeroU64,
) -> HostMessage {
    HostMessage::from(SessionOpenedMessage {
        channel,
        conversation_mode: wire_mode(mode),
        kind: SessionOpenedMessageKind::SessionOpened,
        request_id: request.clone(),
        session_id: session.clone(),
        workspace_id: workspace.clone(),
    })
}

pub fn failed(request: &Identifier, code: RequestFailedMessageCode) -> HostMessage {
    failed_with(request, code, &[])
}

/// A `request.failed` with string parameters; a parameter that breaks the protocol's limits is
/// left out.
pub fn failed_with(
    request: &Identifier,
    code: RequestFailedMessageCode,
    parameters: &[(&str, Option<&str>)],
) -> HostMessage {
    let mut values = std::collections::HashMap::new();
    for (name, value) in parameters {
        let value = value.and_then(|value| ParametersValueString::try_from(value).ok());
        if let (Ok(name), Some(value)) = (ParametersKey::try_from(*name), value) {
            values.insert(name, ParametersValue::String(value));
        }
    }
    HostMessage::from(RequestFailedMessage {
        code,
        kind: RequestFailedMessageKind::RequestFailed,
        parameters: Parameters(values),
        request_id: request.clone(),
    })
}

/// The answer to a `session.send` whose text reached the provider.
pub fn sent(request: &Identifier, session: &Identifier) -> HostMessage {
    HostMessage::from(SessionSentMessage {
        kind: SessionSentMessageKind::SessionSent,
        request_id: request.clone(),
        session_id: session.clone(),
    })
}

/// The `request.failed` for a failure the core reported, with its code and stage as parameters.
pub fn core_failed(request: &Identifier, failure: &Failure) -> HostMessage {
    let code = match failure.code {
        FailureCode::WorkspaceStartFailed => RequestFailedMessageCode::WorkspaceStartFailed,
        FailureCode::WorkspaceNotFound => RequestFailedMessageCode::WorkspaceNotFound,
        FailureCode::LaunchIntentInvalid => RequestFailedMessageCode::LaunchIntentInvalid,
        FailureCode::ProviderCliUnavailable => RequestFailedMessageCode::ProviderCliUnavailable,
        FailureCode::ProviderLoginUnavailable => RequestFailedMessageCode::ProviderLoginUnavailable,
        FailureCode::ConversationModeUnsupported => {
            RequestFailedMessageCode::ConversationModeUnsupported
        }
        FailureCode::ApplicationFailed => RequestFailedMessageCode::ApplicationFailed,
        FailureCode::ApplicationUnavailable => RequestFailedMessageCode::ApplicationUnavailable,
        FailureCode::ApplicationTimeout => RequestFailedMessageCode::ApplicationTimeout,
    };
    failed_with(
        request,
        code,
        &[
            ("coreCode", failure.core_code.as_deref()),
            ("stage", failure.stage.as_deref()),
            ("reason", failure.reason),
        ],
    )
}

pub fn application_result(request: &Identifier, result: Map<String, Value>) -> HostMessage {
    HostMessage::from(ApplicationResultMessage {
        kind: ApplicationResultMessageKind::ApplicationResult,
        request_id: request.clone(),
        result,
    })
}

pub fn page(
    request: &Identifier,
    session: &Identifier,
    items: Vec<ConversationItem>,
    has_earlier: bool,
    has_later: bool,
) -> HostMessage {
    HostMessage::from(ConversationPageMessage {
        has_earlier,
        has_later,
        items,
        kind: ConversationPageMessageKind::ConversationPage,
        request_id: request.clone(),
        session_id: session.clone(),
    })
}

pub fn appended(
    session: &Identifier,
    sequence: NonZeroU64,
    items: Vec<ConversationItem>,
) -> HostMessage {
    HostMessage::from(ConversationAppendedMessage {
        items,
        kind: ConversationAppendedMessageKind::ConversationAppended,
        sequence: Sequence(sequence),
        session_id: session.clone(),
    })
}

/// A delta, or `None` when the text or the identifier breaks the protocol's limits. The
/// transcript keeps deltas within them, so `None` means a defect upstream.
pub fn delta(
    session: &Identifier,
    sequence: NonZeroU64,
    item: &str,
    text: &str,
) -> Option<HostMessage> {
    Some(HostMessage::from(ConversationDeltaMessage {
        append: ConversationDeltaMessageAppend::try_from(text).ok()?,
        item_id: Identifier::try_from(item).ok()?,
        kind: ConversationDeltaMessageKind::ConversationDelta,
        sequence: Sequence(sequence),
        session_id: session.clone(),
    }))
}

pub fn resync_required(session: &Identifier) -> HostMessage {
    HostMessage::from(SessionResyncRequiredMessage {
        kind: SessionResyncRequiredMessageKind::SessionResyncRequired,
        session_id: session.clone(),
    })
}
