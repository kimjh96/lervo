//! The session status machine (sessions specification; protocol `session.status`).

/// Why a session ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EndReason {
    /// The agent finished and the provider process exited cleanly.
    Completed,
    /// The user stopped the session.
    Stopped,
    /// The session failed to start or to run.
    Failed,
    /// The provider process exited on its own with a failure.
    ProviderExited,
}

/// The status a session reports to clients.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionStatus {
    Starting,
    Working,
    NeedsUser,
    Idle,
    Ended(EndReason),
}

/// Something that happened to a session.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionEvent {
    /// The provider process is running and waits for input.
    Launched,
    /// The agent started a turn.
    TurnStarted,
    /// The agent asked the user a question.
    QuestionAsked,
    /// The agent finished its turn.
    TurnFinished,
    /// The provider process is gone.
    Exited(EndReason),
}

/// An event that cannot follow the current status. The caller records it and keeps the status.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
#[error("session_event_out_of_order: {event:?} while {status:?}")]
pub struct OutOfOrder {
    pub status: SessionStatus,
    pub event: SessionEvent,
}

impl SessionStatus {
    /// The status after `event`.
    pub fn apply(self, event: SessionEvent) -> Result<Self, OutOfOrder> {
        use SessionEvent as Event;
        use SessionStatus as Status;
        let next = match (self, event) {
            (Status::Ended(_), _) => None,
            (_, Event::Exited(reason)) => Some(Status::Ended(reason)),
            (Status::Starting, Event::Launched) => Some(Status::Idle),
            (Status::Starting | Status::Idle | Status::NeedsUser, Event::TurnStarted) => {
                Some(Status::Working)
            }
            (Status::Working, Event::TurnStarted) => Some(Status::Working),
            (Status::Working, Event::QuestionAsked) => Some(Status::NeedsUser),
            (Status::Working | Status::NeedsUser, Event::TurnFinished) => Some(Status::Idle),
            _ => None,
        };
        next.ok_or(OutOfOrder {
            status: self,
            event,
        })
    }

    /// Whether the session no longer runs.
    pub fn is_ended(self) -> bool {
        matches!(self, Self::Ended(_))
    }
}

#[cfg(test)]
mod tests {
    use super::{EndReason, OutOfOrder, SessionEvent as Event, SessionStatus as Status};

    #[test]
    fn follows_a_full_turn() {
        let status = Status::Starting
            .apply(Event::Launched)
            .and_then(|status| status.apply(Event::TurnStarted))
            .and_then(|status| status.apply(Event::QuestionAsked))
            .and_then(|status| status.apply(Event::TurnStarted))
            .and_then(|status| status.apply(Event::TurnFinished))
            .and_then(|status| status.apply(Event::Exited(EndReason::Completed)));
        assert_eq!(status, Ok(Status::Ended(EndReason::Completed)));
    }

    #[test]
    fn starts_working_when_the_first_instruction_comes_with_the_launch() {
        assert_eq!(
            Status::Starting.apply(Event::TurnStarted),
            Ok(Status::Working)
        );
    }

    #[test]
    fn ends_from_any_running_status() {
        for status in [
            Status::Starting,
            Status::Working,
            Status::NeedsUser,
            Status::Idle,
        ] {
            assert_eq!(
                status.apply(Event::Exited(EndReason::Stopped)),
                Ok(Status::Ended(EndReason::Stopped))
            );
        }
    }

    #[test]
    fn rejects_events_that_cannot_follow() {
        for (status, event) in [
            (Status::Idle, Event::QuestionAsked),
            (Status::Idle, Event::TurnFinished),
            (Status::Working, Event::Launched),
            (Status::Ended(EndReason::Completed), Event::TurnStarted),
            (
                Status::Ended(EndReason::Failed),
                Event::Exited(EndReason::Completed),
            ),
        ] {
            assert_eq!(status.apply(event), Err(OutOfOrder { status, event }));
        }
    }
}
