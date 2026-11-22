//! The `lervo-session-host` executable.

use std::process::ExitCode;

use lervo_session_host::arguments::{Command, parse};
use lervo_session_host::paths::Layout;
use lervo_session_host::ports::Disconnected;
use lervo_session_host::serve::{ServeError, run};
use lervo_session_transport::handshake::HostIdentity;

const USAGE: &str = "usage: lervo-session-host --version | serve [--state-dir <path>]";

fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    match parse(&arguments) {
        Command::Version => {
            println!("lervo-session-host {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        Command::Usage => {
            eprintln!("{USAGE}");
            ExitCode::from(2)
        }
        Command::Serve { state_dir } => serve(state_dir),
    }
}

fn serve(state_dir: Option<std::path::PathBuf>) -> ExitCode {
    let Some(layout) = state_dir.map(Layout::at).or_else(Layout::default_for_user) else {
        eprintln!("lervo-session-host: no state directory for this user");
        return ExitCode::FAILURE;
    };
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("lervo-session-host: {error}");
            return ExitCode::FAILURE;
        }
    };
    let identity = HostIdentity {
        host_id: "host_local".to_owned(),
        name: "lervo-session-host".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
    };
    let result = runtime.block_on(run(&layout, Disconnected, identity, shutdown_signal()));
    match result {
        Ok(()) | Err(ServeError::AlreadyRunning) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("lervo-session-host: {error}");
            ExitCode::FAILURE
        }
    }
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        if let Ok(mut terminate) = signal(SignalKind::terminate()) {
            tokio::select! {
                _ = terminate.recv() => {}
                _ = tokio::signal::ctrl_c() => {}
            }
            return;
        }
    }
    let _ = tokio::signal::ctrl_c().await;
}
