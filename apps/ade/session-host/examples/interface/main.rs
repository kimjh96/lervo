//! A session host with a scripted core, so the real shell and webview run without the Lervo core
//! or a provider: the interface harness scenarios and visual checks (ADE performance,
//! "Measurement").
//!
//! `cargo run --release -p lervo-session-host --example interface -- serve <state-dir>` seeds a
//! native conversation of 100,000 items and serves until SIGINT or SIGTERM. The shell reaches it
//! with `LERVO_SESSION_HOST_DIR=<state-dir>`. The scripted core lists four workspaces:
//!
//! - `wks_history`, a native conversation over the seeded items;
//! - `wks_stream`, a native conversation whose provider streams timestamped deltas after each
//!   reply;
//! - `wks_echo`, a CLI conversation whose provider echoes what is typed;
//! - `wks_deploy`, an empty native conversation in a second repository.
//!
//! The streaming provider is this example itself, run with `emit`.

mod core;
mod seed;

use std::path::PathBuf;
use std::process::ExitCode;

use lervo_session_host::paths::Layout;
use lervo_session_host::serve::run;
use lervo_session_transport::handshake::HostIdentity;
use lervo_session_transport::token::create_private_directory;

use crate::core::{HISTORY_SESSION, InterfaceCore};

/// Items in the seeded conversation.
const HISTORY_ITEMS: u64 = 100_000;
const USAGE: &str = "usage: interface serve <state-dir> | emit";

fn main() -> ExitCode {
    let mut arguments = std::env::args().skip(1);
    match (arguments.next().as_deref(), arguments.next()) {
        (Some("emit"), None) => core::emit(),
        (Some("serve"), Some(root)) => serve(PathBuf::from(root)),
        _ => {
            eprintln!("{USAGE}");
            ExitCode::from(2)
        }
    }
}

fn serve(root: PathBuf) -> ExitCode {
    let layout = Layout::at(root);
    let seeded = create_private_directory(&layout.root)
        .map_err(|error| error.to_string())
        .and_then(|()| {
            seed::conversation(&layout.indexes.join(HISTORY_SESSION), HISTORY_ITEMS)
                .map_err(|error| error.to_string())
        });
    if let Err(error) = seeded {
        eprintln!("interface: the conversation could not be seeded: {error}");
        return ExitCode::FAILURE;
    }
    let Ok(runtime) = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
    else {
        return ExitCode::FAILURE;
    };
    let identity = HostIdentity {
        host_id: "host_interface".to_owned(),
        name: "lervo-session-host".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
    };
    match runtime.block_on(run(&layout, InterfaceCore::default(), identity, shutdown())) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("interface: {error}");
            ExitCode::FAILURE
        }
    }
}

async fn shutdown() {
    use tokio::signal::unix::{SignalKind, signal};
    match signal(SignalKind::terminate()) {
        Ok(mut terminate) => {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = terminate.recv() => {}
            }
        }
        Err(_) => {
            let _ = tokio::signal::ctrl_c().await;
        }
    }
}
