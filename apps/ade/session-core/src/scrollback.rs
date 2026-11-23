//! The CLI conversation's bounded scrollback (performance rules, "Conversations grow without
//! bound"). It keeps the newest terminal output up to a byte limit so a reattaching client can
//! catch up. Chunks are shared buffers: the fan-out, the scrollback, and every replay hold the
//! same bytes, never copies (performance rules, "Memory").

use std::collections::VecDeque;
use std::sync::Arc;

/// Default limit of retained terminal bytes per session.
pub const DEFAULT_SCROLLBACK_BYTES: usize = 2 * 1024 * 1024;
/// Bytes an ended session keeps: enough to show its final screen to a client that attaches late.
pub const ENDED_SCROLLBACK_BYTES: usize = 256 * 1024;

#[derive(Debug)]
struct Chunk {
    sequence: u64,
    bytes: Arc<[u8]>,
}

/// Terminal output chunks, newest last, with at most `limit` bytes in total.
#[derive(Debug)]
pub struct Scrollback {
    chunks: VecDeque<Chunk>,
    bytes: usize,
    limit: usize,
}

impl Scrollback {
    /// Scrollback that retains at most `limit` bytes.
    pub fn new(limit: usize) -> Self {
        Self {
            chunks: VecDeque::new(),
            bytes: 0,
            limit,
        }
    }

    /// Appends a chunk and drops the oldest chunks beyond the limit. A chunk larger than the
    /// limit keeps only its newest bytes, the one case that copies.
    pub fn push(&mut self, sequence: u64, bytes: &Arc<[u8]>) {
        if bytes.is_empty() {
            return;
        }
        let kept = if bytes.len() > self.limit {
            Arc::from(&bytes[bytes.len() - self.limit..])
        } else {
            Arc::clone(bytes)
        };
        self.bytes += kept.len();
        self.chunks.push_back(Chunk {
            sequence,
            bytes: kept,
        });
        while self.bytes > self.limit {
            match self.chunks.pop_front() {
                Some(chunk) => self.bytes -= chunk.bytes.len(),
                None => break,
            }
        }
    }

    /// Lowers the limit to `limit` and drops the oldest chunks beyond it, returning their memory.
    pub fn shrink_to(&mut self, limit: usize) {
        self.limit = self.limit.min(limit);
        while self.bytes > self.limit {
            match self.chunks.pop_front() {
                Some(chunk) => self.bytes -= chunk.bytes.len(),
                None => break,
            }
        }
        self.chunks.shrink_to_fit();
    }

    /// Retained chunks whose sequence comes after `after_sequence`, oldest first.
    pub fn since(&self, after_sequence: u64) -> impl Iterator<Item = (u64, &Arc<[u8]>)> {
        self.chunks
            .iter()
            .filter(move |chunk| chunk.sequence > after_sequence)
            .map(|chunk| (chunk.sequence, &chunk.bytes))
    }

    /// Retained bytes.
    pub fn len(&self) -> usize {
        self.bytes
    }

    /// Whether nothing is retained.
    pub fn is_empty(&self) -> bool {
        self.bytes == 0
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::Scrollback;

    fn chunk(bytes: &[u8]) -> Arc<[u8]> {
        Arc::from(bytes)
    }

    fn replay(scrollback: &Scrollback, after: u64) -> Vec<(u64, Vec<u8>)> {
        scrollback
            .since(after)
            .map(|(sequence, bytes)| (sequence, bytes.to_vec()))
            .collect()
    }

    #[test]
    fn replays_chunks_after_a_sequence() {
        let mut scrollback = Scrollback::new(64);
        scrollback.push(1, &chunk(b"one"));
        scrollback.push(2, &chunk(b"two"));
        scrollback.push(3, &chunk(b"three"));
        assert_eq!(
            replay(&scrollback, 1),
            vec![(2, b"two".to_vec()), (3, b"three".to_vec())]
        );
    }

    #[test]
    fn drops_the_oldest_chunks_beyond_the_limit() {
        let mut scrollback = Scrollback::new(8);
        scrollback.push(1, &chunk(b"aaaa"));
        scrollback.push(2, &chunk(b"bbbb"));
        scrollback.push(3, &chunk(b"cc"));
        assert!(scrollback.len() <= 8);
        let sequences: Vec<_> = scrollback.since(0).map(|(sequence, _)| sequence).collect();
        assert_eq!(sequences, vec![2, 3]);
    }

    #[test]
    fn keeps_the_tail_of_an_oversized_chunk() {
        let mut scrollback = Scrollback::new(4);
        scrollback.push(1, &chunk(b"0123456789"));
        assert_eq!(replay(&scrollback, 0), vec![(1, b"6789".to_vec())]);
        assert_eq!(scrollback.len(), 4);
    }

    #[test]
    fn shares_chunks_instead_of_copying_them() {
        let mut scrollback = Scrollback::new(64);
        let bytes = chunk(b"shared");
        scrollback.push(1, &bytes);
        let (_, kept) = scrollback.since(0).next().unwrap();
        assert!(Arc::ptr_eq(kept, &bytes));
    }

    #[test]
    fn ignores_empty_output() {
        let mut scrollback = Scrollback::new(4);
        scrollback.push(1, &chunk(b""));
        assert!(scrollback.is_empty());
    }

    #[test]
    fn shrinks_to_its_newest_bytes() {
        let mut scrollback = Scrollback::new(100);
        for sequence in 1..=10 {
            scrollback.push(sequence, &chunk(&[0; 10]));
        }
        scrollback.shrink_to(30);
        assert_eq!(scrollback.len(), 30);
        assert_eq!(
            scrollback
                .since(0)
                .map(|(sequence, _)| sequence)
                .collect::<Vec<_>>(),
            [8, 9, 10]
        );
        scrollback.push(11, &chunk(&[0; 10]));
        assert_eq!(scrollback.len(), 30);
    }
}
