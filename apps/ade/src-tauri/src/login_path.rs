//! The user's login-shell `PATH`. An application opened from the Dock or a launcher inherits a
//! minimal `PATH`, so the session host would not find `lervo` or the provider CLIs without it.

use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const DEADLINE: Duration = Duration::from_secs(3);
const MARKER: &str = "__LERVO_PATH__";

/// The `PATH` of a login shell, or `None` when the shell does not answer in time.
pub fn login_path() -> Option<String> {
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|shell| shell.starts_with('/'))?;
    let mut child = Command::new(shell)
        .args([
            "-l",
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
