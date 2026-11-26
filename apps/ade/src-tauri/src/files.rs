//! Files a person attaches to a message by path (Lervo ADE sessions, "Files in a message"). The
//! webview never learns a file's path, so the shell reads the paths of copied files from the
//! system clipboard, describes paths, reads a dropped image's bytes, and shows a file in Finder.

use std::path::Path;

use serde::Serialize;

/// The largest dropped image the shell reads; the interface scales an image down before sending.
const MAX_IMAGE_BYTES: u64 = 64 * 1024 * 1024;

/// A file as the interface shows it: where it is, its name, and whether it is still there.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDetails {
    path: String,
    name: String,
    /// The size in bytes of a file; none for a folder or a missing file.
    size: Option<u64>,
    directory: bool,
    exists: bool,
}

fn describe(path: &str) -> FileDetails {
    let name = Path::new(path).file_name().map_or_else(
        || path.to_owned(),
        |name| name.to_string_lossy().into_owned(),
    );
    match std::fs::metadata(path) {
        Ok(metadata) => FileDetails {
            path: path.to_owned(),
            name,
            size: metadata.is_file().then_some(metadata.len()),
            directory: metadata.is_dir(),
            exists: true,
        },
        Err(_) => FileDetails {
            path: path.to_owned(),
            name,
            size: None,
            directory: false,
            exists: false,
        },
    }
}

/// The files on the system clipboard, such as those copied in Finder; none when it holds no file.
#[tauri::command]
pub fn pasted_files() -> Vec<FileDetails> {
    clipboard::file_paths()
        .iter()
        .map(|path| describe(path))
        .collect()
}

/// Each path as a file the interface shows: a dropped file, or one a sent message names.
#[tauri::command]
pub fn describe_files(paths: Vec<String>) -> Vec<FileDetails> {
    paths.iter().map(|path| describe(path)).collect()
}

/// The bytes of a dropped image file, which the interface prepares like a pasted image.
#[tauri::command]
pub async fn read_image_file(path: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let size = std::fs::metadata(&path)
            .map_err(|error| error.to_string())?
            .len();
        if size > MAX_IMAGE_BYTES {
            return Err("image_too_large".to_owned());
        }
        std::fs::read(&path)
            .map(tauri::ipc::Response::new)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Shows a file in Finder, selected; a missing file is left alone.
#[tauri::command]
pub fn reveal_file(path: String) {
    #[cfg(target_os = "macos")]
    {
        // `open` returns at once; Finder comes forward on its own.
        if Path::new(&path).exists() {
            let _ = std::process::Command::new("/usr/bin/open")
                .arg("-R")
                .arg(&path)
                .spawn();
        }
    }
    #[cfg(not(target_os = "macos"))]
    drop(path);
}

#[cfg(target_os = "macos")]
mod clipboard {
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::{NSString, NSURL};

    /// The paths of the file URLs on the general pasteboard. Finder writes a file reference URL
    /// (`file:///.file/id=…`), which `filePathURL` resolves to the file's path.
    pub fn file_paths() -> Vec<String> {
        let file_url = NSString::from_str("public.file-url");
        let Some(items) = NSPasteboard::generalPasteboard().pasteboardItems() else {
            return Vec::new();
        };
        items
            .iter()
            .filter_map(|item| item.stringForType(&file_url))
            .filter_map(|text| NSURL::URLWithString(&text))
            .filter_map(|url| url.filePathURL())
            .filter_map(|url| url.path())
            .map(|path| path.to_string())
            .collect()
    }
}

#[cfg(not(target_os = "macos"))]
mod clipboard {
    pub fn file_paths() -> Vec<String> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::describe;

    #[test]
    fn describes_files_folders_and_missing_paths() {
        let directory = std::env::temp_dir().join(format!("lervo-files-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let file = directory.join("note.txt");
        std::fs::write(&file, b"seven b").unwrap();

        let described = describe(file.to_str().unwrap());
        assert_eq!(described.name, "note.txt");
        assert_eq!(described.size, Some(7));
        assert!(described.exists && !described.directory);

        let folder = describe(directory.to_str().unwrap());
        assert!(folder.exists && folder.directory);
        assert_eq!(folder.size, None);

        let missing = describe(directory.join("gone.pdf").to_str().unwrap());
        assert_eq!(missing.name, "gone.pdf");
        assert!(!missing.exists);

        std::fs::remove_dir_all(&directory).unwrap();
    }
}
