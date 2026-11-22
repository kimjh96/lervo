//! The Lervo desktop shell (ADR-0613). It opens the window that renders the React interface.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::ExitCode;

fn main() -> ExitCode {
    match tauri::Builder::default().run(tauri::generate_context!()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Lervo could not open its window: {error}");
            ExitCode::FAILURE
        }
    }
}
