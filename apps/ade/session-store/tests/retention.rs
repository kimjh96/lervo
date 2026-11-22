//! The index cap on disk.

// A failing setup step should stop the test at once, so this test file may unwrap.
#![allow(clippy::unwrap_used)]

use std::time::Duration;

use lervo_session_store::ConversationStore;
use lervo_session_store::retention::{enforce, touch};

#[test]
fn removes_the_least_recently_opened_index_beyond_the_cap() {
    let root = tempfile::tempdir().unwrap();
    for name in ["ses_old", "ses_new"] {
        let directory = root.path().join(name);
        touch(&directory).unwrap();
        let mut store = ConversationStore::open(&directory, 0).unwrap();
        store.append(&[7_u8; 1000]).unwrap();
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(enforce(root.path(), 1500, &["ses_new"]).unwrap(), 1);
    assert!(!root.path().join("ses_old").exists());
    assert!(root.path().join("ses_new").exists());
    assert_eq!(enforce(root.path(), 1500, &["ses_new"]).unwrap(), 0);
}
