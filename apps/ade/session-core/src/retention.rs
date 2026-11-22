//! Which conversation indexes to remove when all of them exceed their cap (sessions
//! specification, "Conversation index"). Indexes are rebuildable projections, so removal loses
//! nothing canonical.

/// Bytes all conversation indexes on a host may use together.
pub const INDEX_CAP_BYTES: u64 = 1024 * 1024 * 1024;

/// One index on disk.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IndexEntry {
    pub name: String,
    pub bytes: u64,
    /// When the index was last opened, in any monotonic unit.
    pub opened_at: u64,
}

/// The names to remove, least recently opened first, until the rest fit within `cap`. Indexes
/// named in `keep`, such as those of sessions that still run, are never removed.
pub fn evictions(mut entries: Vec<IndexEntry>, cap: u64, keep: &[&str]) -> Vec<String> {
    let mut total: u64 = entries.iter().map(|entry| entry.bytes).sum();
    entries.sort_by(|a, b| {
        a.opened_at
            .cmp(&b.opened_at)
            .then_with(|| a.name.cmp(&b.name))
    });
    let mut removed = Vec::new();
    for entry in entries {
        if total <= cap {
            break;
        }
        if !keep.contains(&entry.name.as_str()) {
            total -= entry.bytes;
            removed.push(entry.name);
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::{IndexEntry, evictions};

    fn entry(name: &str, bytes: u64, opened_at: u64) -> IndexEntry {
        IndexEntry {
            name: name.to_owned(),
            bytes,
            opened_at,
        }
    }

    #[test]
    fn removes_the_least_recently_opened_until_the_rest_fit() {
        let entries = vec![
            entry("new", 40, 3),
            entry("old", 40, 1),
            entry("mid", 40, 2),
        ];
        assert_eq!(evictions(entries, 80, &["new"]), vec!["old".to_owned()]);
    }

    #[test]
    fn never_removes_an_index_in_use() {
        let entries = vec![
            entry("open", 100, 1),
            entry("live", 30, 2),
            entry("other", 10, 3),
        ];
        assert_eq!(
            evictions(entries, 50, &["open", "live"]),
            vec!["other".to_owned()]
        );
    }

    #[test]
    fn removes_nothing_within_the_cap() {
        assert!(evictions(vec![entry("a", 10, 1)], 10, &["b"]).is_empty());
    }
}
