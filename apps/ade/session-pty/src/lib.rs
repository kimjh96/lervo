//! The PTY adapter (ADE convention, "Layers"). One external boundary: the operating system's
//! pseudo-terminal through `portable-pty`.
//!
//! A dedicated thread per session blocks on the PTY, so an idle session costs no CPU. Output goes
//! through a bounded channel: a slow consumer makes the reader wait, which slows the child process
//! instead of growing memory. Input goes through another bounded channel to a writer thread, so
//! a blocking write never holds up an async worker.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;

use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use tokio::sync::mpsc;

const READ_BYTES: usize = 16 * 1024;
const OUTPUT_CHUNKS: usize = 32;
const INPUT_CHUNKS: usize = 32;

/// What to run in the PTY.
#[derive(Clone, Debug)]
pub struct PtyCommand {
    pub program: String,
    pub arguments: Vec<String>,
    pub environment: Vec<(String, String)>,
    pub working_directory: PathBuf,
    pub columns: u16,
    pub rows: u16,
}

/// Why the PTY failed.
#[derive(Debug, thiserror::Error)]
pub enum PtyError {
    #[error("pty_unavailable: {0}")]
    Unavailable(String),
    /// The program is not on the filesystem or in the command's `PATH`.
    #[error("pty_program_missing: {0}")]
    Missing(String),
    #[error("pty_spawn_failed: {0}")]
    Spawn(String),
    #[error("pty_io: {0}")]
    Io(#[from] std::io::Error),
}

/// A running process in a PTY.
pub struct PtyProcess {
    master: Box<dyn MasterPty + Send>,
    input: mpsc::Sender<Vec<u8>>,
    child: Box<dyn Child + Send + Sync>,
    output: mpsc::Receiver<Arc<[u8]>>,
}

/// How the process ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Exit {
    pub success: bool,
    pub code: u32,
}

impl PtyProcess {
    /// Starts `command` in a new PTY.
    pub fn spawn(command: &PtyCommand) -> Result<Self, PtyError> {
        let pair = native_pty_system()
            .openpty(size(command.columns, command.rows))
            .map_err(|error| PtyError::Unavailable(error.to_string()))?;
        let mut builder = CommandBuilder::new(&command.program);
        builder.args(&command.arguments);
        builder.cwd(&command.working_directory);
        for (name, value) in &command.environment {
            builder.env(name, value);
        }
        let child = pair.slave.spawn_command(builder).map_err(|error| {
            if resolvable(&command.program, &command.environment) {
                PtyError::Spawn(error.to_string())
            } else {
                PtyError::Missing(command.program.clone())
            }
        })?;
        drop(pair.slave);
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| PtyError::Unavailable(error.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| PtyError::Unavailable(error.to_string()))?;
        let (sender, output) = mpsc::channel(OUTPUT_CHUNKS);
        std::thread::Builder::new()
            .name("lervo-pty-reader".to_owned())
            .spawn(move || read_until_closed(reader, &sender))?;
        let (input, chunks) = mpsc::channel(INPUT_CHUNKS);
        std::thread::Builder::new()
            .name("lervo-pty-writer".to_owned())
            .spawn(move || write_until_closed(writer, chunks))?;
        Ok(Self {
            master: pair.master,
            input,
            child,
            output,
        })
    }

    /// The next output chunk, or `None` once the PTY closed. Each chunk is one shared buffer,
    /// which the session host passes on without copying it again.
    pub async fn output(&mut self) -> Option<Arc<[u8]>> {
        self.output.recv().await
    }

    /// Where input, such as keystrokes, goes to the writer thread. Reserving a slot waits while
    /// the process does not read; the send fails once the PTY closed for writing.
    pub fn input(&self) -> &mpsc::Sender<Vec<u8>> {
        &self.input
    }

    /// Resizes the terminal.
    pub fn resize(&self, columns: u16, rows: u16) -> Result<(), PtyError> {
        self.master
            .resize(size(columns, rows))
            .map_err(|error| PtyError::Unavailable(error.to_string()))
    }

    /// Stops the process.
    pub fn kill(&mut self) -> Result<(), PtyError> {
        self.child.kill()?;
        Ok(())
    }

    /// Waits for the process to end.
    pub fn wait(&mut self) -> Result<Exit, PtyError> {
        let status = self.child.wait()?;
        Ok(Exit {
            success: status.success(),
            code: status.exit_code(),
        })
    }
}

fn size(columns: u16, rows: u16) -> PtySize {
    PtySize {
        rows,
        cols: columns,
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn write_until_closed(mut writer: Box<dyn Write + Send>, mut chunks: mpsc::Receiver<Vec<u8>>) {
    while let Some(bytes) = chunks.blocking_recv() {
        if writer
            .write_all(&bytes)
            .and_then(|()| writer.flush())
            .is_err()
        {
            return;
        }
    }
}

/// Whether `program` names a file, directly or through the command's or this process's `PATH`.
fn resolvable(program: &str, environment: &[(String, String)]) -> bool {
    let path = std::path::Path::new(program);
    if path.components().count() > 1 {
        return path.is_file();
    }
    let search = environment
        .iter()
        .rev()
        .find(|(name, _)| name == "PATH")
        .map(|(_, value)| std::ffi::OsString::from(value))
        .or_else(|| std::env::var_os("PATH"));
    search.is_some_and(|search| {
        std::env::split_paths(&search).any(|directory| directory.join(program).is_file())
    })
}

fn read_until_closed(mut reader: Box<dyn Read + Send>, sender: &mpsc::Sender<Arc<[u8]>>) {
    let mut buffer = vec![0_u8; READ_BYTES];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) | Err(_) => return,
            Ok(read) => {
                if sender.blocking_send(Arc::from(&buffer[..read])).is_err() {
                    return;
                }
            }
        }
    }
}
