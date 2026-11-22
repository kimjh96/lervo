//! Applies the cap on all conversation indexes in one directory.

use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use lervo_session_core::retention::{IndexEntry, evictions};

const OPENED_MARKER: &str = "opened";

/// Marks the index in `directory` as opened now.
pub fn touch(directory: &Path) -> std::io::Result<()> {
    fs::create_dir_all(directory)?;
    fs::write(directory.join(OPENED_MARKER), [])
}

/// Removes the least recently opened indexes under `root` until all fit within `cap` bytes, and
/// returns how many it removed. Indexes named in `keep` stay.
pub fn enforce(root: &Path, cap: u64, keep: &[&str]) -> std::io::Result<usize> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        entries.push(IndexEntry {
            bytes: directory_bytes(&entry.path())?,
            opened_at: opened_at(&entry.path()),
            name,
        });
    }
    let removed = evictions(entries, cap, keep);
    for name in &removed {
        fs::remove_dir_all(root.join(name))?;
    }
    Ok(removed.len())
}

fn directory_bytes(directory: &Path) -> std::io::Result<u64> {
    let mut bytes = 0;
    for entry in fs::read_dir(directory)? {
        let metadata = entry?.metadata()?;
        if metadata.is_file() {
            bytes += metadata.len();
        }
    }
    Ok(bytes)
}

/// Milliseconds since the epoch of the last open, or 0 when the marker is missing.
fn opened_at(directory: &Path) -> u64 {
    fs::metadata(directory.join(OPENED_MARKER))
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |since| {
            u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
        })
}
