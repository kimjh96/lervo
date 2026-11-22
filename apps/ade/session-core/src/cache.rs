//! A least-recently-used cache bounded by bytes (performance rules, "Memory").
//!
//! The session host caches decoded conversation segments here. It holds a few dozen entries at
//! most, so a recency-ordered vector keeps the code simple without a measurable cost.

/// A cache that keeps at most `limit` bytes of values, evicting the least recently used first.
#[derive(Debug)]
pub struct ByteBoundedCache<K, V> {
    entries: Vec<(K, V, usize)>,
    bytes: usize,
    limit: usize,
}

impl<K: PartialEq, V> ByteBoundedCache<K, V> {
    /// An empty cache with a byte limit.
    pub fn new(limit: usize) -> Self {
        Self {
            entries: Vec::new(),
            bytes: 0,
            limit,
        }
    }

    /// The value for `key`, which becomes the most recently used.
    pub fn get(&mut self, key: &K) -> Option<&V> {
        let index = self.entries.iter().position(|(entry, _, _)| entry == key)?;
        let entry = self.entries.remove(index);
        self.entries.push(entry);
        self.entries.last().map(|(_, value, _)| value)
    }

    /// Stores `value` with its size in bytes and evicts least recently used entries until the
    /// cache fits its limit. A value larger than the limit is not stored.
    pub fn insert(&mut self, key: K, value: V, size: usize) {
        self.remove(&key);
        if size > self.limit {
            return;
        }
        self.bytes += size;
        self.entries.push((key, value, size));
        while self.bytes > self.limit && !self.entries.is_empty() {
            let (_, _, evicted) = self.entries.remove(0);
            self.bytes -= evicted;
        }
    }

    /// Removes `key` and returns its value.
    pub fn remove(&mut self, key: &K) -> Option<V> {
        let index = self.entries.iter().position(|(entry, _, _)| entry == key)?;
        let (_, value, size) = self.entries.remove(index);
        self.bytes -= size;
        Some(value)
    }

    /// Bytes held.
    pub fn bytes(&self) -> usize {
        self.bytes
    }

    /// Entries held.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the cache is empty.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::ByteBoundedCache;

    #[test]
    fn evicts_the_least_recently_used_entry() {
        let mut cache = ByteBoundedCache::new(10);
        cache.insert(1, "a", 4);
        cache.insert(2, "b", 4);
        assert_eq!(cache.get(&1), Some(&"a"));
        cache.insert(3, "c", 4);
        assert_eq!(cache.get(&2), None);
        assert_eq!(cache.get(&1), Some(&"a"));
        assert_eq!(cache.get(&3), Some(&"c"));
        assert_eq!(cache.bytes(), 8);
    }

    #[test]
    fn replaces_an_existing_key() {
        let mut cache = ByteBoundedCache::new(10);
        cache.insert(1, "a", 4);
        cache.insert(1, "b", 6);
        assert_eq!(cache.len(), 1);
        assert_eq!(cache.bytes(), 6);
        assert_eq!(cache.get(&1), Some(&"b"));
    }

    #[test]
    fn skips_values_larger_than_the_limit() {
        let mut cache = ByteBoundedCache::new(4);
        cache.insert(1, "big", 5);
        assert!(cache.is_empty());
        assert_eq!(cache.bytes(), 0);
    }
}
