//! Per-session sequence numbers (session-host protocol, "Sequencing and resumption").

use std::num::NonZeroU64;

/// Hands out the sequence numbers of one session. They start at 1 and only grow.
#[derive(Debug)]
pub struct SequenceCounter {
    last: u64,
}

impl SequenceCounter {
    /// A counter whose first sequence is 1.
    pub fn new() -> Self {
        Self { last: 0 }
    }

    /// A counter that continues after `last`, for a session restored from its index.
    pub fn after(last: u64) -> Self {
        Self { last }
    }

    /// The next sequence. Saturates at `u64::MAX`, which no session reaches in practice.
    pub fn advance(&mut self) -> NonZeroU64 {
        self.last = self.last.saturating_add(1);
        NonZeroU64::new(self.last).unwrap_or(NonZeroU64::MAX)
    }

    /// The last sequence handed out, or 0 before the first.
    pub fn last(&self) -> u64 {
        self.last
    }
}

impl Default for SequenceCounter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::SequenceCounter;

    #[test]
    fn starts_at_one_and_grows() {
        let mut counter = SequenceCounter::new();
        assert_eq!(counter.last(), 0);
        assert_eq!(counter.advance().get(), 1);
        assert_eq!(counter.advance().get(), 2);
        assert_eq!(counter.last(), 2);
    }

    #[test]
    fn continues_after_a_restored_sequence() {
        let mut counter = SequenceCounter::after(41);
        assert_eq!(counter.advance().get(), 42);
    }

    #[test]
    fn saturates_instead_of_wrapping() {
        let mut counter = SequenceCounter::after(u64::MAX);
        assert_eq!(counter.advance().get(), u64::MAX);
    }
}
