//! The Lervo desktop shell (ADR-0613). It opens the window that renders the React interface and
//! relays between the interface and the session host, which owns every process.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod host_link;
mod host_program;
mod login_path;
mod material;
mod window;

use std::process::ExitCode;

use lervo_session_transport::paths::Layout;

use crate::commands::Relay;

fn main() -> ExitCode {
    let path = login_path::LoginPath::resolve();
    let relay = Relay {
        program: host_program::HostProgram::locate(path),
        layout: Layout::for_user(),
        outgoing: tokio::sync::Mutex::new(None),
    };
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(material::plugin())
        .manage(relay)
        .on_page_load(window::on_page_load)
        .invoke_handler(tauri::generate_handler![
            commands::host_connect,
            commands::host_send,
            commands::host_input,
            window::window_ready
        ])
        .run(tauri::generate_context!());
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Lervo could not open its window: {error}");
            ExitCode::FAILURE
        }
    }
}
