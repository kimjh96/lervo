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

/// Asks a running session host to end with SIGTERM, so it ends its sessions' providers as on any
/// shutdown and removes its socket. The next connection then starts the session host beside the
/// shell. `process` must name one process: zero and negative IDs would signal process groups.
pub fn terminate(process: i32) -> std::io::Result<()> {
    if process <= 1 || u32::try_from(process).ok() == Some(std::process::id()) {
        return Err(std::io::Error::from(std::io::ErrorKind::InvalidInput));
    }
    #[cfg(unix)]
    return nix::sys::signal::kill(
        nix::unistd::Pid::from_raw(process),
        nix::sys::signal::Signal::SIGTERM,
    )
    .map_err(std::io::Error::from);
    #[cfg(not(unix))]
    Err(std::io::Error::from(std::io::ErrorKind::Unsupported))
}

#[cfg(test)]
mod tests {
    use super::terminate;

    #[test]
    fn refuses_process_groups_and_itself() {
        for process in [-1, 0, 1] {
            assert!(terminate(process).is_err());
        }
        let own = i32::try_from(std::process::id()).unwrap_or(0);
        assert!(terminate(own).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn ends_a_process_with_sigterm() -> std::io::Result<()> {
        use std::os::unix::process::ExitStatusExt;
        let mut child = std::process::Command::new("sleep").arg("30").spawn()?;
        let process = i32::try_from(child.id()).map_err(std::io::Error::other)?;
        terminate(process)?;
        assert_eq!(child.wait()?.signal(), Some(15));
        Ok(())
    }
}
