//! Where the session host keeps its state on each platform.

use std::path::{Path, PathBuf};

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
