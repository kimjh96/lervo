//! Load scenarios for the session host (ADE performance, "Measurement"): streaming at the
//! fastest rate, input during a terminal flood, and a soak of repeated sessions.
//!
//! `cargo run --release -p lervo-session-host --example load -- streaming|flood|soak` serves on a
//! temporary socket with a stand-in core and prints one JSON line. The streaming provider is this
//! example itself, run with `emit`, which prints the current time as fast as it can.

mod client;
mod core;
mod scenarios;

use std::process::ExitCode;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use lervo_session_host::paths::Layout;
use lervo_session_host::serve::run;
use lervo_session_transport::handshake::HostIdentity;

use crate::client::Client;
use crate::core::LoadCore;

pub const STREAM_LINES: u64 = 20_000;
pub const FLOOD_PROBES: u32 = 50;
pub const SOAK_SESSIONS: u32 = 200;

pub fn now_ns() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_nanos())
}

fn emit() -> ExitCode {
    use std::io::{BufRead, Write};
    let mut go = String::new();
    if std::io::stdin().lock().read_line(&mut go).is_err() {
        return ExitCode::FAILURE;
    }
    let mut out = std::io::stdout().lock();
    for _ in 0..STREAM_LINES {
        if writeln!(out, "{}", now_ns())
            .and_then(|()| out.flush())
            .is_err()
        {
            return ExitCode::FAILURE;
        }
    }
    std::thread::sleep(Duration::from_secs(2));
    ExitCode::SUCCESS
}

fn main() -> ExitCode {
    let scenario = std::env::args().nth(1).unwrap_or_default();
    if scenario == "emit" {
        return emit();
    }
    let Ok(directory) = tempfile::tempdir() else {
        return ExitCode::FAILURE;
    };
    let Ok(runtime) = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
    else {
        return ExitCode::FAILURE;
    };
    let result = runtime.block_on(async {
        let layout = Layout::at(directory.path().join("host"));
        let identity = HostIdentity {
            host_id: "host_load".to_owned(),
            name: "lervo-session-host".to_owned(),
            version: "0.1.0".to_owned(),
        };
        let serving = {
            let layout = layout.clone();
            tokio::spawn(
                async move { run(&layout, LoadCore, identity, std::future::pending()).await },
            )
        };
        let mut client = Client::connect(&layout).await?;
        let result = match scenario.as_str() {
            "streaming" => scenarios::streaming(&mut client).await,
            "flood" => scenarios::flood(&mut client).await,
            "soak" => scenarios::soak(&mut client).await,
            _ => None,
        };
        serving.abort();
        result
    });
    match result {
        Some(result) => {
            println!("{result}");
            ExitCode::SUCCESS
        }
        None => {
            eprintln!("usage: load streaming|flood|soak");
            ExitCode::FAILURE
        }
    }
}
