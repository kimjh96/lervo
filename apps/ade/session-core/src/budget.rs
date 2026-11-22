//! The per-client output budget (session-host protocol, "Sequencing and resumption").

/// Bytes a client may have queued for one session before it must resynchronize.
pub const CLIENT_BUFFER_LIMIT: usize = 4 * 1024 * 1024;

/// Tracks the bytes queued for one client and session.
#[derive(Debug)]
pub struct ClientBudget {
    queued: usize,
    limit: usize,
    overflowed: bool,
}

/// The client fell behind. The host drops its terminal frames and sends `session.resync_required`.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
#[error("client_buffer_full: {queued} of {limit} bytes queued")]
pub struct Overflow {
    pub queued: usize,
    pub limit: usize,
}

/// The outcome of `ClientBudget::admit`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Admission {
    Queue,
    Resync,
    Drop,
}

impl ClientBudget {
    /// A budget with the given byte limit.
    pub fn new(limit: usize) -> Self {
        Self {
            queued: 0,
            limit,
            overflowed: false,
        }
    }

    /// Reserves room for `bytes`. After an overflow, every reservation fails until `reset`.
    pub fn reserve(&mut self, bytes: usize) -> Result<(), Overflow> {
        let queued = self.queued.saturating_add(bytes);
        if self.overflowed || queued > self.limit {
            self.overflowed = true;
            return Err(Overflow {
                queued: self.queued,
                limit: self.limit,
            });
        }
        self.queued = queued;
        Ok(())
    }

    /// Decides what happens to an item of `bytes` for this client: queue it, replace it with one
    /// `session.resync_required`, or drop it because the client already must resynchronize.
    pub fn admit(&mut self, bytes: usize) -> Admission {
        let already = self.overflowed;
        match self.reserve(bytes) {
            Ok(()) => Admission::Queue,
            Err(_) if already => Admission::Drop,
            Err(_) => Admission::Resync,
        }
    }

    /// Releases `bytes` after the transport wrote them.
    pub fn release(&mut self, bytes: usize) {
        self.queued = self.queued.saturating_sub(bytes);
    }

    /// Clears an overflow after the client attached again.
    pub fn reset(&mut self) {
        self.queued = 0;
        self.overflowed = false;
    }

    /// Bytes currently queued.
    pub fn queued(&self) -> usize {
        self.queued
    }
}

impl Default for ClientBudget {
    fn default() -> Self {
        Self::new(CLIENT_BUFFER_LIMIT)
    }
}

#[cfg(test)]
mod tests {
    use super::{Admission, ClientBudget, Overflow};

    #[test]
    fn reserves_and_releases_within_the_limit() {
        let mut budget = ClientBudget::new(10);
        assert_eq!(budget.reserve(6), Ok(()));
        budget.release(4);
        assert_eq!(budget.reserve(8), Ok(()));
        assert_eq!(budget.queued(), 10);
    }

    #[test]
    fn stays_overflowed_until_reset() {
        let mut budget = ClientBudget::new(10);
        assert_eq!(
            budget.reserve(11),
            Err(Overflow {
                queued: 0,
                limit: 10
            })
        );
        budget.release(100);
        assert!(budget.reserve(1).is_err());
        budget.reset();
        assert_eq!(budget.reserve(1), Ok(()));
    }

    #[test]
    fn asks_for_one_resync_and_then_drops() {
        let mut budget = ClientBudget::new(10);
        assert_eq!(budget.admit(10), Admission::Queue);
        assert_eq!(budget.admit(1), Admission::Resync);
        budget.release(10);
        assert_eq!(budget.admit(1), Admission::Drop);
    }
}
