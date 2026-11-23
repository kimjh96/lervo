//! The session host's diagnostics log (ADE roadmap, "Session host diagnostics"): one JSON line per
//! event in the host state directory, so a connection that ended with an error or an accept that
//! failed leaves a trace. It records event names, counts, sizes, identifiers, and codes, never a
//! message body or terminal bytes (session-host protocol, "Privacy and failure"). A writer thread
//! owns the file, so recording never waits on the disk, and a full queue drops the entry.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, SyncSender};
use std::time::{SystemTime, UNIX_EPOCH};

/// Bytes in the current log file before it rotates. The log keeps the current file and the one
/// before it, so it never holds more than twice this.
pub const LOG_FILE_BYTES: u64 = 512 * 1024;
/// Entries waiting for the writer; more are dropped rather than delay the host.
const QUEUE: usize = 256;
/// Longest code or identifier the log keeps as written.
const MAX_CODE_CHARS: usize = 128;

/// One value of an entry: a count or a size, or a code or an identifier.
pub enum Field<'a> {
    Number(u64),
    /// Written only when it looks like a code or an identifier; anything else is `redacted`.
    Code(&'a str),
}

/// The handle every part of the host records through. A disabled log records nothing.
#[derive(Clone)]
pub struct Diagnostics {
    sender: Option<SyncSender<String>>,
}

impl Diagnostics {
    pub fn disabled() -> Self {
        Self { sender: None }
    }

    /// Starts the writer for the log at `path`. A log that cannot open is disabled, because the
    /// host must serve whether or not it can write diagnostics.
    pub fn open(path: PathBuf, limit: u64) -> Self {
        let Ok(mut writer) = Writer::open(path, limit) else {
            return Self::disabled();
        };
        let (sender, receiver) = mpsc::sync_channel::<String>(QUEUE);
        let started = std::thread::Builder::new()
            .name("lervo-diagnostics".to_owned())
            .spawn(move || {
                while let Ok(line) = receiver.recv() {
                    let _ = writer.write(&line);
                }
            });
        match started {
            Ok(_) => Self {
                sender: Some(sender),
            },
            Err(_) => Self::disabled(),
        }
    }

    /// Records `event` with `fields`, now.
    pub fn record(&self, event: &str, fields: &[(&str, Field<'_>)]) {
        if let Some(sender) = &self.sender {
            let _ = sender.try_send(entry(now_ms(), event, fields));
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}

/// Whether `value` can be written as it is: letters, digits, and `_ . : / -`, at most 128.
fn is_code(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= MAX_CODE_CHARS
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | ':' | '/' | '-'))
}

/// One JSON line for an entry.
pub(crate) fn entry(at_ms: u64, event: &str, fields: &[(&str, Field<'_>)]) -> String {
    let mut object = serde_json::Map::new();
    object.insert("atMs".to_owned(), serde_json::Value::from(at_ms));
    let event = if is_code(event) { event } else { "redacted" };
    object.insert("event".to_owned(), serde_json::Value::from(event));
    for (name, field) in fields {
        let value = match field {
            Field::Number(number) => serde_json::Value::from(*number),
            Field::Code(code) if is_code(code) => serde_json::Value::from(*code),
            Field::Code(_) => serde_json::Value::from("redacted"),
        };
        object.insert((*name).to_owned(), value);
    }
    let mut line = serde_json::Value::Object(object).to_string();
    line.push('\n');
    line
}

/// Appends lines to the log, rotating it to `<name>.1` before a line would pass the limit.
pub(crate) struct Writer {
    path: PathBuf,
    limit: u64,
    file: File,
    size: u64,
}

impl Writer {
    pub(crate) fn open(path: PathBuf, limit: u64) -> io::Result<Self> {
        let file = open_log(&path)?;
        let size = file.metadata()?.len();
        Ok(Self {
            path,
            limit,
            file,
            size,
        })
    }

    pub(crate) fn write(&mut self, line: &str) -> io::Result<()> {
        let bytes = line.len() as u64;
        if self.size > 0 && self.size + bytes > self.limit {
            fs::rename(&self.path, rotated(&self.path))?;
            self.file = open_log(&self.path)?;
            self.size = 0;
        }
        self.file.write_all(line.as_bytes())?;
        self.size += bytes;
        Ok(())
    }
}

/// The rotated file beside `path`: `diagnostics.log.1`.
pub(crate) fn rotated(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".1");
    PathBuf::from(name)
}

fn open_log(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

#[cfg(test)]
mod tests {
    use super::{Field, Writer, entry, rotated};

    #[test]
    fn writes_codes_and_numbers_and_redacts_anything_else() {
        let line = entry(
            7,
            "connection.ended",
            &[
                ("connection", Field::Number(3)),
                ("code", Field::Code("transport_io:BrokenPipe")),
                ("text", Field::Code("Fix the build, please")),
            ],
        );
        let value: serde_json::Value = serde_json::from_str(&line).unwrap_or_default();
        assert_eq!(value["atMs"], 7);
        assert_eq!(value["event"], "connection.ended");
        assert_eq!(value["connection"], 3);
        assert_eq!(value["code"], "transport_io:BrokenPipe");
        assert_eq!(value["text"], "redacted");
        assert!(line.ends_with('\n'));
    }

    #[test]
    fn keeps_two_files_and_drops_the_oldest_entries() -> std::io::Result<()> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("diagnostics.log");
        let mut writer = Writer::open(path.clone(), 400)?;
        for number in 0..100_u64 {
            writer.write(&entry(
                number,
                "request.failed",
                &[("number", Field::Number(number))],
            ))?;
        }
        let current = std::fs::read_to_string(&path)?;
        let previous = std::fs::read_to_string(rotated(&path))?;
        assert!(current.len() <= 400 && previous.len() <= 400);
        assert!(current.contains("\"number\":99"));
        assert!(!current.contains("\"number\":0,") && !previous.contains("\"number\":0,"));
        Ok(())
    }
}
