//! The stream adapter against real processes.

// A failing setup step should stop the test at once, so this test file may unwrap.
#![allow(clippy::unwrap_used)]
#![cfg(unix)]

use std::time::Duration;

use lervo_session_stream::{StreamCommand, StreamProcess};

fn shell(script: &str) -> StreamCommand {
    StreamCommand {
        program: "/bin/sh".to_owned(),
        arguments: vec!["-c".to_owned(), script.to_owned()],
        environment: vec![("LERVO_STREAM_TEST".to_owned(), "set".to_owned())],
        working_directory: std::env::temp_dir(),
    }
}

async fn all_output(process: &mut StreamProcess) -> String {
    let mut output = Vec::new();
    while let Some(chunk) = tokio::time::timeout(Duration::from_secs(10), process.output())
        .await
        .unwrap()
        .unwrap()
    {
        output.extend(chunk);
    }
    String::from_utf8(output).unwrap()
}

#[tokio::test]
async fn echoes_structured_lines_through_stdin_and_stdout() {
    let mut process =
        StreamProcess::spawn(&shell("while read line; do printf '%s\\n' \"$line\"; done")).unwrap();
    process.input(b"{\"type\":\"user\"}\n").await.unwrap();
    process.close_input();
    assert_eq!(all_output(&mut process).await, "{\"type\":\"user\"}\n");
    assert!(process.wait().await.unwrap().success);
}

#[tokio::test]
async fn reports_the_exit_code_while_discarding_standard_error() {
    let script = "head -c 1000000 /dev/zero >&2; printf \"$LERVO_STREAM_TEST\"; exit 4";
    let mut process = StreamProcess::spawn(&shell(script)).unwrap();
    assert_eq!(all_output(&mut process).await, "set");
    let exit = process.wait().await.unwrap();
    assert_eq!((exit.success, exit.code), (false, Some(4)));
}

#[tokio::test]
async fn stops_a_running_process() {
    let mut process = StreamProcess::spawn(&shell("sleep 30")).unwrap();
    process.kill().await.unwrap();
    assert!(!process.wait().await.unwrap().success);
}
