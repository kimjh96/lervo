//! The conversation index of one session (performance rules, "Conversations grow without bound").
//!
//! Items are stored as length-prefixed records in segment files of `ITEMS_PER_SEGMENT` items.
//! The index is a rebuildable projection of the provider's transcript, so appends skip `fsync`
//! and a torn final record is truncated when the index opens. Sealed segments are cached in a
//! byte-bounded cache; the open segment is read from the file.

pub mod retention;

use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::ops::Range;
use std::path::{Path, PathBuf};

use lervo_session_core::cache::ByteBoundedCache;
use lervo_session_core::paging::{ITEMS_PER_SEGMENT, locate};

/// The largest encoded item, matching the protocol's frame limit.
pub const MAX_RECORD_BYTES: usize = 1024 * 1024;

const HEADER_BYTES: usize = 4;
const SEGMENT_EXTENSION: &str = "seg";

/// Why the index could not be used. `Corrupt` means the caller rebuilds it from the transcript.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("conversation_index_io: {0}")]
    Io(#[from] io::Error),
    #[error("conversation_index_corrupt: segment {segment}")]
    Corrupt { segment: u64 },
    #[error("conversation_item_too_large: {bytes} bytes")]
    RecordTooLarge { bytes: usize },
    #[error("conversation_range_outside_index")]
    OutOfRange,
}

/// A segment read into memory: its bytes and the span of each record.
#[derive(Debug)]
struct Segment {
    bytes: Vec<u8>,
    spans: Vec<(usize, usize)>,
}

impl Segment {
    fn record(&self, slot: usize) -> Option<&[u8]> {
        let &(start, end) = self.spans.get(slot)?;
        self.bytes.get(start..end)
    }
}

/// The conversation index of one session.
#[derive(Debug)]
pub struct ConversationStore {
    directory: PathBuf,
    cache: ByteBoundedCache<u64, Segment>,
    total: u64,
    writer: Option<File>,
}

impl ConversationStore {
    /// Opens or creates the index in `directory`, keeping at most `cache_bytes` of sealed segments
    /// in memory.
    pub fn open(directory: impl Into<PathBuf>, cache_bytes: usize) -> Result<Self, StoreError> {
        let directory = directory.into();
        fs::create_dir_all(&directory)?;
        let segments = segment_ids(&directory)?;
        let total = match segments.last() {
            None => 0,
            Some(&last) => {
                if segments.iter().copied().ne(0..=last) {
                    return Err(StoreError::Corrupt { segment: last });
                }
                let path = segment_path(&directory, last);
                let records = recover_tail(&path)?;
                last * ITEMS_PER_SEGMENT + records
            }
        };
        Ok(Self {
            directory,
            cache: ByteBoundedCache::new(cache_bytes),
            total,
            writer: None,
        })
    }

    /// Items in the index.
    pub fn len(&self) -> u64 {
        self.total
    }

    /// Whether the index holds no items.
    pub fn is_empty(&self) -> bool {
        self.total == 0
    }

    /// Appends one encoded item and returns its position.
    pub fn append(&mut self, item: &[u8]) -> Result<u64, StoreError> {
        if item.len() > MAX_RECORD_BYTES {
            return Err(StoreError::RecordTooLarge { bytes: item.len() });
        }
        let position = self.total;
        let location = locate(position);
        if location.slot == 0 || self.writer.is_none() {
            self.writer = Some(
                OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(segment_path(&self.directory, location.segment))?,
            );
        }
        let length = u32::try_from(item.len())
            .map_err(|_| StoreError::RecordTooLarge { bytes: item.len() })?;
        let mut record = Vec::with_capacity(HEADER_BYTES + item.len());
        record.extend_from_slice(&length.to_be_bytes());
        record.extend_from_slice(item);
        if let Some(writer) = self.writer.as_mut() {
            writer.write_all(&record)?;
        }
        self.total += 1;
        if location.slot + 1 == ITEMS_PER_SEGMENT {
            self.writer = None;
        }
        Ok(position)
    }

    /// The encoded items at positions `[start, end)`.
    pub fn read(&mut self, start: u64, end: u64) -> Result<Vec<Vec<u8>>, StoreError> {
        if start > end || end > self.total {
            return Err(StoreError::OutOfRange);
        }
        let mut items = Vec::with_capacity(usize::try_from(end - start).unwrap_or(0));
        let mut position = start;
        while position < end {
            let location = locate(position);
            let segment_start = location.segment * ITEMS_PER_SEGMENT;
            let segment_end = (segment_start + ITEMS_PER_SEGMENT).min(end);
            items.extend(
                self.copy_records(location.segment, location.slot..segment_end - segment_start)?,
            );
            position = segment_end;
        }
        Ok(items)
    }

    fn copy_records(
        &mut self,
        segment: u64,
        slots: Range<u64>,
    ) -> Result<Vec<Vec<u8>>, StoreError> {
        let sealed = (segment + 1) * ITEMS_PER_SEGMENT <= self.total;
        if !sealed {
            let open = self.load(segment, self.total % ITEMS_PER_SEGMENT)?;
            return copy(&open, segment, slots);
        }
        if let Some(cached) = self.cache.get(&segment) {
            return copy(cached, segment, slots);
        }
        let loaded = self.load(segment, ITEMS_PER_SEGMENT)?;
        let copied = copy(&loaded, segment, slots)?;
        let size = loaded.bytes.len();
        self.cache.insert(segment, loaded, size);
        Ok(copied)
    }

    fn load(&self, segment: u64, expected: u64) -> Result<Segment, StoreError> {
        let mut bytes = Vec::new();
        File::open(segment_path(&self.directory, segment))?.read_to_end(&mut bytes)?;
        let spans = spans(&bytes);
        if spans.complete != bytes.len() || spans.spans.len() as u64 != expected {
            return Err(StoreError::Corrupt { segment });
        }
        Ok(Segment {
            bytes,
            spans: spans.spans,
        })
    }
}

fn copy(segment: &Segment, id: u64, slots: Range<u64>) -> Result<Vec<Vec<u8>>, StoreError> {
    slots
        .map(|slot| {
            usize::try_from(slot)
                .ok()
                .and_then(|slot| segment.record(slot))
                .map(<[u8]>::to_vec)
                .ok_or(StoreError::Corrupt { segment: id })
        })
        .collect()
}

/// Removes the whole index of a session.
pub fn remove(directory: &Path) -> Result<(), StoreError> {
    match fs::remove_dir_all(directory) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error.into()),
        _ => Ok(()),
    }
}

struct Spans {
    spans: Vec<(usize, usize)>,
    complete: usize,
}

/// The records in `bytes`, and how many leading bytes hold complete records.
fn spans(bytes: &[u8]) -> Spans {
    let mut spans = Vec::new();
    let mut offset = 0;
    while let Some(header) = bytes
        .get(offset..)
        .and_then(|rest| rest.first_chunk::<HEADER_BYTES>())
    {
        let length = u32::from_be_bytes(*header) as usize;
        let start = offset + HEADER_BYTES;
        let end = start + length;
        if length > MAX_RECORD_BYTES || end > bytes.len() {
            break;
        }
        spans.push((start, end));
        offset = end;
    }
    Spans {
        spans,
        complete: offset,
    }
}

/// Truncates a torn final record and returns the records the open segment holds.
fn recover_tail(path: &Path) -> Result<u64, StoreError> {
    let bytes = fs::read(path)?;
    let spans = spans(&bytes);
    if spans.complete != bytes.len() {
        OpenOptions::new()
            .write(true)
            .open(path)?
            .set_len(spans.complete as u64)?;
    }
    Ok(spans.spans.len() as u64)
}

fn segment_path(directory: &Path, segment: u64) -> PathBuf {
    directory.join(format!("{segment:016x}.{SEGMENT_EXTENSION}"))
}

fn segment_ids(directory: &Path) -> Result<Vec<u64>, StoreError> {
    let mut ids = Vec::new();
    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        if path
            .extension()
            .is_some_and(|extension| extension == SEGMENT_EXTENSION)
            && let Some(id) = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .and_then(|stem| u64::from_str_radix(stem, 16).ok())
        {
            ids.push(id);
        }
    }
    ids.sort_unstable();
    Ok(ids)
}
