//! Builders for the host messages the session host sends.

use std::num::NonZeroU64;

use lervo_session_core::status::{EndReason, SessionStatus};
use lervo_session_protocol::{
    ApplicationResultMessage, ApplicationResultMessageKind, ConversationAppendedMessage,
    ConversationAppendedMessageKind, ConversationDeltaMessage, ConversationDeltaMessageAppend,
    ConversationDeltaMessageKind, ConversationItem, ConversationMode as WireMode,
    ConversationPageMessage, ConversationPageMessageKind, HostMessage, Identifier, Parameters,
    RequestFailedMessage, RequestFailedMessageCode, RequestFailedMessageKind, Sequence,
    SessionOpenedMessage, SessionOpenedMessageKind, SessionResyncRequiredMessage,
    SessionResyncRequiredMessageKind, SessionStatusMessage, SessionStatusMessageEndReason,
    SessionStatusMessageKind, SessionStatusMessageStatus,
};
use serde_json::{Map, Value};

use crate::ports::{ConversationMode, FailureCode};

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

pub fn opened(
    request: &Identifier,
    session: &Identifier,
    workspace: &Identifier,
    mode: ConversationMode,
    channel: NonZeroU64,
) -> HostMessage {
    HostMessage::from(SessionOpenedMessage {
        channel,
        conversation_mode: match mode {
            ConversationMode::Native => WireMode::Native,
            ConversationMode::Cli => WireMode::Cli,
        },
        kind: SessionOpenedMessageKind::SessionOpened,
        request_id: request.clone(),
        session_id: session.clone(),
        workspace_id: workspace.clone(),
    })
}

pub fn failed(request: &Identifier, code: RequestFailedMessageCode) -> HostMessage {
    HostMessage::from(RequestFailedMessage {
        code,
        kind: RequestFailedMessageKind::RequestFailed,
        parameters: Parameters(Default::default()),
        request_id: request.clone(),
    })
}

pub fn core_failed(request: &Identifier, code: FailureCode) -> HostMessage {
    failed(
        request,
        match code {
            FailureCode::WorkspaceStartFailed => RequestFailedMessageCode::WorkspaceStartFailed,
            FailureCode::ProviderCliUnavailable => RequestFailedMessageCode::ProviderCliUnavailable,
            FailureCode::ProviderLoginUnavailable => {
                RequestFailedMessageCode::ProviderLoginUnavailable
            }
            FailureCode::ApplicationUnavailable => RequestFailedMessageCode::ApplicationUnavailable,
        },
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
