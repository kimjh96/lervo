//! Which `lervo` executable the resident process runs, so the session host notices when the CLI
//! is upgraded beneath it (ADE core link, "Transport").

use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// An executable as it is on disk: its path with links resolved, and its size and time.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgramIdentity {
    path: PathBuf,
    modified: Option<SystemTime>,
    len: u64,
}

/// The executable `program` names now, found as a spawn finds it: on `PATH` when it has no
/// directory part. An install that moves the `lervo` link to a new version, or rewrites the file,
/// changes it. None when the program cannot be found, as on Windows, where `PATHEXT` applies.
pub fn identify(program: &str) -> Option<ProgramIdentity> {
    let found = locate(program)?;
    let path = std::fs::canonicalize(found).ok()?;
    let metadata = std::fs::metadata(&path).ok()?;
    Some(ProgramIdentity {
        path,
        modified: metadata.modified().ok(),
        len: metadata.len(),
    })
}

fn locate(program: &str) -> Option<PathBuf> {
    if Path::new(program).components().count() > 1 {
        return Some(PathBuf::from(program));
    }
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths)
        .map(|directory| directory.join(program))
        .find(|candidate| is_executable(candidate))
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_executable(_path: &Path) -> bool {
    false
}
