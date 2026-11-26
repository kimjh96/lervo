//! The user's shell `PATH`. An application opened from the Dock or a launcher inherits a minimal
//! `PATH`, so the session host would not find `lervo` or the provider CLIs without it.
//!
//! The shell runs as an interactive login shell, as editors resolve the shell environment. Many
//! people add `~/.local/bin`, where Lervo's CLI installs, and node managers such as nvm in the
//! interactive startup file (`~/.zshrc`, `~/.bashrc`), which a non-interactive login shell skips.

use std::process::{Command, Stdio};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

const DEADLINE: Duration = Duration::from_secs(3);
const MARKER: &str = "__LERVO_PATH__";

/// The login shell's `PATH`, resolved on its own thread from startup, so the window never waits
/// for the shell. Only starting the session host needs it, and only then does anything wait.
#[derive(Clone)]
pub struct LoginPath(Arc<OnceLock<Option<String>>>);

impl LoginPath {
    /// Starts resolving the `PATH` in the background.
    pub fn resolve() -> Self {
        let cell = Arc::new(OnceLock::new());
        let filled = Arc::clone(&cell);
        std::thread::spawn(move || {
            let _ = filled.set(login_path());
        });
        Self(cell)
    }

    /// The `PATH`, waiting for the shell at most until its deadline.
    pub fn wait(&self) -> Option<String> {
        self.0.wait().clone()
    }
}

/// The user's shell: `SHELL`, or on macOS its default login shell when the application was opened
/// without one.
fn user_shell() -> Option<String> {
    std::env::var("SHELL")
        .ok()
        .filter(|shell| shell.starts_with('/'))
        .or_else(|| cfg!(target_os = "macos").then(|| "/bin/zsh".to_owned()))
}

/// The `PATH` of an interactive login shell, or `None` when the shell does not answer in time.
fn login_path() -> Option<String> {
    let shell = user_shell()?;
    let mut child = Command::new(shell)
        .args([
            "-l",
            "-i",
            "-c",
            &format!("printf '{MARKER}%s{MARKER}' \"$PATH\""),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < DEADLINE => {
                std::thread::sleep(Duration::from_millis(20));
            }
            _ => {
                let _ = child.kill();
                return None;
            }
        }
    }
    let output = child.wait_with_output().ok()?;
    let text = String::from_utf8(output.stdout).ok()?;
    let path = text.split(MARKER).nth(1)?;
    (!path.is_empty()).then(|| path.to_owned())
}
