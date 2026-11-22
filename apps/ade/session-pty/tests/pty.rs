//! The PTY adapter against real processes.

// A failing setup step should stop the test at once, so this test file may unwrap.
#![allow(clippy::unwrap_used)]
#![cfg(unix)]

use std::time::Duration;

use lervo_session_pty::{PtyCommand, PtyProcess};

fn shell(script: &str) -> PtyCommand {
    PtyCommand {
        program: "/bin/sh".to_owned(),
        arguments: vec!["-c".to_owned(), script.to_owned()],
        environment: vec![("LERVO_PTY_TEST".to_owned(), "set".to_owned())],
        working_directory: std::env::temp_dir(),
        columns: 80,
        rows: 24,
    }
}

async fn all_output(process: &mut PtyProcess) -> String {
    let mut output = Vec::new();
    while let Some(chunk) = tokio::time::timeout(Duration::from_secs(10), process.output())
        .await
        .unwrap()
    {
        output.extend(chunk);
    }
    String::from_utf8_lossy(&output).into_owned()
}

#[tokio::test]
async fn runs_a_command_with_its_environment_and_reports_its_exit() {
    let mut process = PtyProcess::spawn(&shell("printf \"$LERVO_PTY_TEST\"; exit 3")).unwrap();
    assert!(all_output(&mut process).await.contains("set"));
    let exit = process.wait().unwrap();
    assert_eq!((exit.success, exit.code), (false, 3));
}

#[tokio::test]
async fn forwards_input_and_resizes() {
    let mut process = PtyProcess::spawn(&shell("read line; printf \"got:$line\"")).unwrap();
    process.resize(120, 40).unwrap();
    process.input(b"hello\n").unwrap();
    assert!(all_output(&mut process).await.contains("got:hello"));
    assert!(process.wait().unwrap().success);
}

#[tokio::test]
async fn stops_a_running_process() {
    let mut process = PtyProcess::spawn(&shell("sleep 30")).unwrap();
    process.kill().unwrap();
    assert!(!process.wait().unwrap().success);
}
