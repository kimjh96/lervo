//! How the shell finds and starts the session host. The session host outlives the window, so the
//! shell starts it detached and never supervises it after that.

use std::path::PathBuf;
use std::process::Stdio;

use lervo_session_transport::TransportError;

use crate::login_path::LoginPath;

/// How to start the session host.
#[derive(Clone)]
pub struct HostProgram {
    pub executable: PathBuf,
    pub path: LoginPath,
}

impl HostProgram {
    /// `LERVO_SESSION_HOST`, or `lervo-session-host` beside the shell's own executable.
    pub fn locate(path: LoginPath) -> Option<Self> {
        let executable = std::env::var_os("LERVO_SESSION_HOST")
            .map(PathBuf::from)
            .or_else(|| {
                let shell = std::env::current_exe().ok()?;
                Some(shell.parent()?.join("lervo-session-host"))
            })?;
        Some(Self { executable, path })
    }

    /// Starts the session host detached from the shell, so it outlives the window. A second
    /// session host finds the lock held and exits at once, so starting one is always safe.
    pub async fn start(&self) -> Result<(), TransportError> {
        let login = self.path.clone();
        let path = tauri::async_runtime::spawn_blocking(move || login.wait())
            .await
            .ok()
            .flatten();
        let mut command = std::process::Command::new(&self.executable);
        command
            .arg("serve")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if let Some(path) = path {
            command.env("PATH", path);
        }
        command.spawn().map(drop).map_err(TransportError::Io)
    }
}
