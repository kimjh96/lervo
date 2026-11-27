// A failing setup step should stop the test at once, so this test file may unwrap.
#![allow(clippy::unwrap_used)]

use std::fs::{self, OpenOptions};
use std::io::Write;

use lervo_session_core::paging::ITEMS_PER_SEGMENT;
use lervo_session_store::{ConversationStore, MAX_RECORD_BYTES, StoreError, remove};

fn item(position: u64) -> Vec<u8> {
    format!("item {position}").into_bytes()
}

fn filled(directory: &std::path::Path, count: u64) -> ConversationStore {
    let mut store = ConversationStore::open(directory, 1 << 20).unwrap();
    for position in 0..count {
        assert_eq!(store.append(&item(position)).unwrap(), position);
    }
    store
}

#[test]
fn reads_ranges_across_segment_boundaries() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = filled(directory.path(), ITEMS_PER_SEGMENT * 2 + 10);
    let start = ITEMS_PER_SEGMENT - 3;
    let items = store.read(start, ITEMS_PER_SEGMENT * 2 + 2).unwrap();
    assert_eq!(items.len() as u64, ITEMS_PER_SEGMENT + 5);
    for (offset, bytes) in items.iter().enumerate() {
        assert_eq!(bytes, &item(start + offset as u64));
    }
    assert_eq!(store.read(0, 0).unwrap(), Vec::<Vec<u8>>::new());
}

#[test]
fn reopens_with_every_item_in_place() {
    let directory = tempfile::tempdir().unwrap();
    drop(filled(directory.path(), ITEMS_PER_SEGMENT + 7));
    let mut store = ConversationStore::open(directory.path(), 1 << 20).unwrap();
    assert_eq!(store.len(), ITEMS_PER_SEGMENT + 7);
    assert_eq!(store.append(b"next").unwrap(), ITEMS_PER_SEGMENT + 7);
    assert_eq!(
        store
            .read(ITEMS_PER_SEGMENT + 6, ITEMS_PER_SEGMENT + 8)
            .unwrap(),
        vec![item(ITEMS_PER_SEGMENT + 6), b"next".to_vec()]
    );
}

#[test]
fn reads_an_index_without_creating_or_changing_anything() {
    let directory = tempfile::tempdir().unwrap();
    let missing = directory.path().join("none");
    assert!(
        ConversationStore::open_read_only(&missing, 0)
            .unwrap()
            .is_none()
    );
    assert!(!missing.exists());

    let path = directory.path().join("ses_1");
    drop(filled(&path, ITEMS_PER_SEGMENT + 2));
    let segment = path.join("0000000000000001.seg");
    let before = fs::read(&segment).unwrap();
    let mut store = ConversationStore::open_read_only(&path, 0)
        .unwrap()
        .unwrap();
    assert_eq!(store.len(), ITEMS_PER_SEGMENT + 2);
    assert_eq!(
        store
            .read(ITEMS_PER_SEGMENT, ITEMS_PER_SEGMENT + 2)
            .unwrap(),
        vec![item(ITEMS_PER_SEGMENT), item(ITEMS_PER_SEGMENT + 1)]
    );
    assert!(matches!(store.append(b"next"), Err(StoreError::ReadOnly)));

    // A torn final record stays for the writer to truncate, and reading its segment fails.
    OpenOptions::new()
        .append(true)
        .open(&segment)
        .unwrap()
        .write_all(&[0, 0, 0, 9, b'x'])
        .unwrap();
    let mut torn = ConversationStore::open_read_only(&path, 0)
        .unwrap()
        .unwrap();
    assert_eq!(torn.len(), ITEMS_PER_SEGMENT + 2);
    assert!(torn.read(ITEMS_PER_SEGMENT, ITEMS_PER_SEGMENT + 1).is_err());
    assert_eq!(fs::read(&segment).unwrap().len(), before.len() + 5);
}

#[test]
fn truncates_a_torn_final_record() {
    let directory = tempfile::tempdir().unwrap();
    drop(filled(directory.path(), 3));
    let segment = directory.path().join("0000000000000000.seg");
    OpenOptions::new()
        .append(true)
        .open(&segment)
        .unwrap()
        .write_all(&[0, 0, 0, 9, b'x'])
        .unwrap();
    let mut store = ConversationStore::open(directory.path(), 1 << 20).unwrap();
    assert_eq!(store.len(), 3);
    assert_eq!(store.append(b"after").unwrap(), 3);
    assert_eq!(store.read(2, 4).unwrap(), vec![item(2), b"after".to_vec()]);
}

#[test]
fn reports_a_damaged_sealed_segment() {
    let directory = tempfile::tempdir().unwrap();
    drop(filled(directory.path(), ITEMS_PER_SEGMENT + 1));
    let segment = directory.path().join("0000000000000000.seg");
    let bytes = fs::read(&segment).unwrap();
    fs::write(&segment, &bytes[..bytes.len() - 2]).unwrap();
    let mut store = ConversationStore::open(directory.path(), 1 << 20).unwrap();
    assert!(matches!(
        store.read(0, 1),
        Err(StoreError::Corrupt { segment: 0 })
    ));
}

#[test]
fn reports_a_missing_segment() {
    let directory = tempfile::tempdir().unwrap();
    drop(filled(directory.path(), ITEMS_PER_SEGMENT * 2 + 1));
    fs::remove_file(directory.path().join("0000000000000001.seg")).unwrap();
    assert!(matches!(
        ConversationStore::open(directory.path(), 1 << 20),
        Err(StoreError::Corrupt { .. })
    ));
}

#[test]
fn rejects_oversized_items_and_ranges_outside_the_index() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = filled(directory.path(), 2);
    assert!(matches!(
        store.append(&vec![0; MAX_RECORD_BYTES + 1]),
        Err(StoreError::RecordTooLarge { .. })
    ));
    assert!(matches!(store.read(1, 3), Err(StoreError::OutOfRange)));
    assert!(matches!(store.read(2, 1), Err(StoreError::OutOfRange)));
}

#[test]
fn reads_sealed_segments_with_a_tiny_cache() {
    let directory = tempfile::tempdir().unwrap();
    drop(filled(directory.path(), ITEMS_PER_SEGMENT * 3));
    let mut store = ConversationStore::open(directory.path(), 16).unwrap();
    for _ in 0..2 {
        assert_eq!(store.read(5, 6).unwrap(), vec![item(5)]);
        assert_eq!(
            store
                .read(ITEMS_PER_SEGMENT * 2, ITEMS_PER_SEGMENT * 2 + 1)
                .unwrap(),
            vec![item(ITEMS_PER_SEGMENT * 2)]
        );
    }
}

#[test]
fn removes_a_whole_index() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("session");
    drop(filled(&path, 2));
    remove(&path).unwrap();
    assert!(!path.exists());
    remove(&path).unwrap();
}
