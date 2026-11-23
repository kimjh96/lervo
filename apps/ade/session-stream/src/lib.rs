//! The structured-stream process adapter (ADE convention, "Layers"). One external boundary: a
//! child process whose stdin and stdout carry the provider's structured stream.
//!
//! The adapter moves bytes only. Decoding the stream into conversation items belongs to the
//! provider adapters in the Lervo core, so this crate never branches on a provider.

use std::path::PathBuf;
use std::process::Stdio;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

const READ_BYTES: usize = 64 * 1024;

/// What to run.
#[derive(Clone, Debug)]
pub struct StreamCommand {
    pub program: String,
    pub arguments: Vec<String>,
    pub environment: Vec<(String, String)>,
    /// Variables of this process's environment the child must not inherit.
    pub environment_remove: Vec<String>,
    pub working_directory: PathBuf,
}

/// Why the process failed.
#[derive(Debug, thiserror::Error)]
pub enum StreamError {
    #[error("stream_spawn_failed: {0}")]
    Spawn(std::io::Error),
    #[error("stream_io: {0}")]
    Io(#[from] std::io::Error),
    #[error("stream_input_closed")]
    InputClosed,
}

/// How the process ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Exit {
    pub success: bool,
    pub code: Option<i32>,
}

/// A running provider process.
pub struct StreamProcess {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: ChildStdout,
    buffer: Vec<u8>,
}

impl StreamProcess {
    /// Starts `command` with piped standard input and output. Standard error is discarded, so a
    /// provider that writes much there never blocks. The process is killed if this value drops.
    pub fn spawn(command: &StreamCommand) -> Result<Self, StreamError> {
        let mut builder = Command::new(&command.program);
        for name in &command.environment_remove {
            builder.env_remove(name);
        }
        let mut child = builder
            .args(&command.arguments)
            .envs(
                command
                    .environment
                    .iter()
                    .map(|(name, value)| (name, value)),
            )
            .current_dir(&command.working_directory)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(StreamError::Spawn)?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().ok_or(StreamError::InputClosed)?;
        Ok(Self {
            child,
            stdin,
            stdout,
            buffer: vec![0_u8; READ_BYTES],
        })
    }

    /// The next chunk of standard output, or `None` at its end.
    pub async fn output(&mut self) -> Result<Option<Vec<u8>>, StreamError> {
        let read = self.stdout.read(&mut self.buffer).await?;
        Ok((read > 0).then(|| self.buffer[..read].to_vec()))
    }

    /// Writes to standard input.
    pub async fn input(&mut self, bytes: &[u8]) -> Result<(), StreamError> {
        let stdin = self.stdin.as_mut().ok_or(StreamError::InputClosed)?;
        stdin.write_all(bytes).await?;
        stdin.flush().await?;
        Ok(())
    }

    /// Closes standard input, which tells the provider that no more input follows.
    pub fn close_input(&mut self) {
        self.stdin = None;
    }

    /// Stops the process.
    pub async fn kill(&mut self) -> Result<(), StreamError> {
        self.child.kill().await?;
        Ok(())
    }

    /// Waits for the process to end.
    pub async fn wait(&mut self) -> Result<Exit, StreamError> {
        let status = self.child.wait().await?;
        Ok(Exit {
            success: status.success(),
            code: status.code(),
        })
    }
}
