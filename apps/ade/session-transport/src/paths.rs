//! Where the session host keeps its state on each platform.

use std::path::{Path, PathBuf};

/// Names a state directory that replaces the platform default, so an isolated session host can
/// serve beside the user's own: tests, the interface harness, and a second profile.
pub const DIRECTORY_VARIABLE: &str = "LERVO_SESSION_HOST_DIR";

/// The session host's files inside one owner-only state directory.
#[derive(Clone, Debug)]
pub struct Layout {
    pub root: PathBuf,
    pub socket: PathBuf,
    pub token: PathBuf,
    pub lock: PathBuf,
    /// One conversation index per native session.
    pub indexes: PathBuf,
}

impl Layout {
    /// The layout inside `root`.
    pub fn at(root: impl AsRef<Path>) -> Self {
        let root = root.as_ref().to_path_buf();
        Self {
            socket: root.join("session-host.sock"),
            token: root.join("connection-token"),
            lock: root.join("session-host.lock"),
            indexes: root.join("conversations"),
            root,
        }
    }

    /// The directory `LERVO_SESSION_HOST_DIR` names when it is set and not empty, otherwise the
    /// platform default. The shell and the session host both resolve it this way, so a shell
    /// started with the variable reaches, and when needed starts, the session host it names.
    pub fn for_user() -> Option<Self> {
        match std::env::var_os(DIRECTORY_VARIABLE) {
            Some(directory) if !directory.is_empty() => Some(Self::at(directory)),
            _ => Self::default_for_user(),
        }
    }

    /// The platform default: `~/Library/Application Support/dev.lervo.ade` on macOS and
    /// `$XDG_STATE_HOME/lervo-ade` (or `~/.local/state/lervo-ade`) on Linux and WSL.
    pub fn default_for_user() -> Option<Self> {
        let root = if cfg!(target_os = "macos") {
            dirs::data_local_dir()?.join("dev.lervo.ade")
        } else {
            dirs::state_dir()
                .or_else(|| dirs::home_dir().map(|home| home.join(".local/state")))?
                .join("lervo-ade")
        };
        Some(Self::at(root))
    }
}
