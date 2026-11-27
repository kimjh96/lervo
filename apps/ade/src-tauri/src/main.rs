//! The Lervo desktop shell (ADR-0613). It opens the window that renders the React interface and
//! relays between the interface and the session host, which owns every process.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod files;
mod host_link;
mod host_program;
mod login_path;
mod material;
mod measure;
mod notifications;
mod window;

use std::process::ExitCode;

use lervo_session_transport::paths::Layout;

use crate::commands::Relay;

fn main() -> ExitCode {
    let started = std::time::SystemTime::now();
    let path = login_path::LoginPath::resolve();
    let relay = Relay::new(host_program::HostProgram::locate(path), Layout::for_user());
    let measurement = measure::Measurement::from_environment(started);
    let result = tauri::Builder::default()
        // The plugin shows notifications where the shell has no native path (`notifications`).
        .plugin(tauri_plugin_notification::init())
        // The system's open panel picks a project folder or a mark image (Lervo ADE projects).
        .plugin(tauri_plugin_dialog::init())
        .plugin(material::plugin())
        .plugin(measure::plugin(measurement.as_ref()))
        .manage(relay)
        .manage(measurement)
        .setup(|_app| {
            #[cfg(debug_assertions)]
            window::apply_development_appearance(_app);
            Ok(())
        })
        .on_page_load(window::on_page_load)
        .on_window_event(window::on_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::host_connect,
            commands::host_send,
            commands::host_replace,
            window::window_ready,
            measure::measure_report,
            measure::measure_hide,
            measure::measure_opaque,
            notifications::notify,
            files::pasted_files,
            files::describe_files,
            files::read_image_file,
            files::reveal_file,
            files::open_folder
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
