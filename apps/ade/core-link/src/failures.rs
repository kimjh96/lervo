//! The core's failure codes in the session host's terms. The core-link protocol names them, so
//! this adapter, not the domain, reads them.

use lervo_session_core::ports::{Failure, FailureCode};

use crate::link::LinkError;

/// The failure for a code the core reported, keeping the core's code and stage for diagnosis.
pub(crate) fn from_core(core_code: &str, stage: Option<String>) -> Failure {
    let code = match core_code {
        "workspace_start_failed" => FailureCode::WorkspaceStartFailed,
        "workspace_not_found" => FailureCode::WorkspaceNotFound,
        "launch_intent_invalid" | "resume_unsupported" | "provider_unknown" => {
            FailureCode::LaunchIntentInvalid
        }
        "provider_cli_unavailable" => FailureCode::ProviderCliUnavailable,
        "provider_login_unavailable" => FailureCode::ProviderLoginUnavailable,
        "conversation_mode_unsupported" => FailureCode::ConversationModeUnsupported,
        "interrupt_unsupported" => FailureCode::InterruptUnsupported,
        "images_unsupported" => FailureCode::ImagesUnsupported,
        "question_not_open" | "questions_unsupported" => FailureCode::QuestionNotOpen,
        _ => FailureCode::ApplicationFailed,
    };
    Failure {
        code,
        core_code: Some(core_code.to_owned()),
        stage,
        reason: None,
    }
}

/// The failure for a request the link could not complete: an unreachable process and one that
/// did not answer in time stay distinct.
pub(crate) fn from_link(error: &LinkError) -> Failure {
    match error {
        LinkError::Unavailable => Failure::new(FailureCode::ApplicationUnavailable),
        LinkError::Timeout => Failure::new(FailureCode::ApplicationTimeout),
        // The process that advertised the command is gone, so its successor may not know it.
        LinkError::Replaced => unsupported(),
    }
}

/// The failure for a command the running resident process has not advertised.
pub(crate) fn unsupported() -> Failure {
    Failure::new(FailureCode::ApplicationUnavailable).because("command_unsupported")
}

/// The failure for a command result that does not match the command's schema.
pub(crate) fn result_invalid() -> Failure {
    Failure::new(FailureCode::ApplicationFailed).because("result_invalid")
}

#[cfg(test)]
mod tests {
    use lervo_session_core::ports::FailureCode;

    use super::{from_core, from_link};
    use crate::link::LinkError;

    #[test]
    fn names_the_core_codes_and_keeps_them() {
        let failure = from_core("workspace_start_failed", Some("workstream".to_owned()));
        assert_eq!(failure.code, FailureCode::WorkspaceStartFailed);
        assert_eq!(failure.stage.as_deref(), Some("workstream"));
        assert_eq!(
            from_core("resume_unsupported", None).code,
            FailureCode::LaunchIntentInvalid
        );
        let unknown = from_core("disk_full", None);
        assert_eq!(unknown.code, FailureCode::ApplicationFailed);
        assert_eq!(unknown.core_code.as_deref(), Some("disk_full"));
    }

    #[test]
    fn keeps_a_timeout_apart_from_an_unreachable_process() {
        assert_eq!(
            from_link(&LinkError::Timeout).code,
            FailureCode::ApplicationTimeout
        );
        assert_eq!(
            from_link(&LinkError::Unavailable).code,
            FailureCode::ApplicationUnavailable
        );
    }
}
