//! The core-link adapter against a stand-in resident process.

// A failing setup step should stop the test at once, so this test file may unwrap.
#![allow(clippy::unwrap_used)]
#![cfg(unix)]

use lervo_core_link::CoreLink;
use lervo_session_core::ports::{ConversationMode, Core, Decoded, FailureCode, StreamDecoder};
use lervo_session_core::status::SessionEvent;
use lervo_session_core::transcript::{Content, Input};
use serde_json::{Map, Value, json};

fn core(program: &str) -> CoreLink {
    release(program, "current")
}

/// The stand-in resident process of one release: "current", "older", or "invalid".
fn release(program: &str, release: &str) -> CoreLink {
    let path = format!("{}/tests/{program}", env!("CARGO_MANIFEST_DIR"));
    CoreLink::new(path, vec![release.to_owned()]).unwrap()
}

/// The stand-in of `release` that collects the `session.exited` reports it receives in `reports`.
fn reporting(release: &str, reports: &std::path::Path) -> CoreLink {
    let path = format!("{}/tests/fake-resident.sh", env!("CARGO_MANIFEST_DIR"));
    CoreLink::new(
        path,
        vec![release.to_owned(), reports.display().to_string()],
    )
    .unwrap()
}

fn none() -> Map<String, Value> {
    Map::new()
}

fn arguments(instruction: &str) -> Map<String, Value> {
    let Value::Object(map) = json!({"instruction": instruction, "repository": "prj_1"}) else {
        unreachable!()
    };
    map
}

#[tokio::test]
async fn runs_commands_and_maps_their_launches_and_failures() {
    let core = core("fake-resident.sh");
    let outcome = core
        .command("workspace.start", arguments("go"))
        .await
        .unwrap();
    let launch = outcome.launch.unwrap();
    assert_eq!(launch.mode, ConversationMode::Native);
    assert_eq!(launch.provider, "claude");
    assert_eq!(launch.initial_input.as_deref(), Some("Fix it."));
    assert_eq!(
        launch.environment,
        vec![("LERVO_TEST".to_owned(), "1".to_owned())]
    );
    assert_eq!(outcome.result.get("workspaceId"), Some(&json!("wsp_1")));

    let failure = core
        .command("workspace.start", arguments("fail"))
        .await
        .unwrap_err();
    assert_eq!(failure.code, FailureCode::WorkspaceStartFailed);
    assert_eq!(failure.stage.as_deref(), Some("workstream"));
    let missing = core.open("wsp_2", None).await.unwrap_err();
    assert_eq!(missing.code, FailureCode::WorkspaceNotFound);
}

#[tokio::test]
async fn decodes_through_the_resident_process() {
    let core = core("fake-resident.sh");
    let launch = core
        .command("workspace.start", arguments("go"))
        .await
        .unwrap()
        .launch
        .unwrap();
    let mut decoder = core.decoder(&launch);
    let (input, shown) = decoder.send("hi").await;
    assert_eq!(input, b"hi\n");
    assert!(matches!(
        shown[..],
        [
            Decoded::Conversation(Input::Item { .. }),
            Decoded::Status(SessionEvent::TurnStarted)
        ]
    ));
    let decoded = decoder.output(b"{\"type\":\"result\"}\n").await;
    assert_eq!(decoded.last(), Some(&Decoded::Conversation(Input::Finish)));
}

#[tokio::test]
async fn reads_transcript_pages_through_the_resident_process() {
    let core = core("fake-resident.sh");
    let first = core.transcript("wsp_1", 0, 500).await.unwrap();
    assert!(!first.complete);
    assert_eq!(
        first.items,
        [Input::Item {
            content: Content::UserMessage("from the terminal".to_owned()),
            created_at_ms: 5,
        }]
    );
    let last = core.transcript("wsp_1", 1, 500).await.unwrap();
    assert!(last.complete && last.items.is_empty());
}

#[tokio::test]
async fn starts_the_resident_process_again_after_it_exits() {
    let core = core("fake-resident.sh");
    let crashed = core
        .command("workspace.start", arguments("crash"))
        .await
        .unwrap_err();
    assert_eq!(crashed.code, FailureCode::ApplicationUnavailable);
    assert!(
        core.command("workspace.start", arguments("go"))
            .await
            .is_ok()
    );
}

#[tokio::test]
async fn reports_a_missing_resident_process_without_failing_the_session() {
    let core = core("missing-resident");
    let failure = core
        .command("workspace.start", arguments("go"))
        .await
        .unwrap_err();
    assert_eq!(failure.code, FailureCode::ApplicationUnavailable);
    let launch = lervo_session_core::ports::Launch {
        session_id: "s".to_owned(),
        workspace_id: "w".to_owned(),
        mode: ConversationMode::Native,
        provider: "claude".to_owned(),
        program: "/opt/claude".to_owned(),
        arguments: Vec::new(),
        environment: Vec::new(),
        working_directory: std::env::temp_dir(),
        initial_input: None,
        environment_remove: Vec::new(),
        transcript: false,
    };
    let (input, shown) = core.decoder(&launch).send("hi").await;
    assert!(input.is_empty());
    assert!(
        matches!(&shown[..], [Decoded::Conversation(Input::Item { content: Content::LervoNotice { code, .. }, .. })] if code == "core_link_unavailable")
    );
}

#[tokio::test]
async fn sends_a_newer_command_only_to_a_process_that_advertised_it() {
    let core = core("fake-resident.sh");
    let early = core.command("provider.list", none()).await.unwrap_err();
    assert_eq!(early.code, FailureCode::ApplicationUnavailable);
    assert_eq!(early.reason, Some("command_unsupported"));

    core.command("workspace.list", none()).await.unwrap();
    let providers = core.command("provider.list", none()).await.unwrap();
    assert_eq!(
        providers.result.get("defaultProvider"),
        Some(&json!("claude"))
    );

    let unknown = core.command("workspace.delete", none()).await.unwrap_err();
    assert_eq!(unknown.reason, Some("command_unsupported"));
}

#[tokio::test]
async fn keeps_newer_commands_from_an_older_process() {
    let core = release("fake-resident.sh", "older");
    core.command("workspace.list", none()).await.unwrap();
    let refused = core.command("provider.list", none()).await.unwrap_err();
    assert_eq!(refused.reason, Some("command_unsupported"));
    // The process never received the command, so it still answers.
    assert!(core.command("workspace.list", none()).await.is_ok());
}

#[tokio::test]
async fn forgets_the_advertisement_when_the_process_ends() {
    let core = core("fake-resident.sh");
    core.command("workspace.list", none()).await.unwrap();
    let crashed = core
        .command("workspace.start", arguments("crash"))
        .await
        .unwrap_err();
    assert_eq!(crashed.code, FailureCode::ApplicationUnavailable);
    let refused = core.command("provider.list", none()).await.unwrap_err();
    assert_eq!(refused.reason, Some("command_unsupported"));
    core.command("workspace.list", none()).await.unwrap();
    assert!(core.command("provider.list", none()).await.is_ok());
}

#[tokio::test]
async fn rejects_a_result_that_breaks_its_schema() {
    let core = release("fake-resident.sh", "invalid");
    core.command("workspace.list", none()).await.unwrap();
    let rejected = core.command("provider.list", none()).await.unwrap_err();
    assert_eq!(rejected.code, FailureCode::ApplicationFailed);
    assert_eq!(rejected.reason, Some("result_invalid"));
}

#[tokio::test]
async fn reports_an_exit_only_to_a_process_that_advertised_it() {
    for (release, expected) in [("current", 1), ("older", 0)] {
        let reports = std::env::temp_dir().join(format!(
            "lervo-exit-reports-{release}-{}.log",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&reports);
        let core = reporting(release, &reports);
        // Nothing is advertised before the first workspace list, so nothing is sent.
        core.session_exited("0b5f7d8e-4a1c-4c2e-9f3a-1d2e3f4a5b6c", Some(137))
            .await;
        core.command("workspace.list", none()).await.unwrap();
        core.session_exited("0b5f7d8e-4a1c-4c2e-9f3a-1d2e3f4a5b6c", Some(137))
            .await;
        let received = std::fs::read_to_string(&reports).unwrap_or_default();
        let lines: Vec<&str> = received.lines().collect();
        assert_eq!(lines.len(), expected, "{release}: {received}");
        if let Some(line) = lines.first() {
            let report: Value = serde_json::from_str(line).unwrap();
            assert_eq!(report["kind"], "session.exited");
            assert_eq!(report["exitCode"], 137);
        }
        let _ = std::fs::remove_file(&reports);
    }
}

/// A copy of the stand-in that a test may upgrade, and the file its starts are counted in.
fn installed(name: &str) -> (std::path::PathBuf, std::path::PathBuf) {
    let directory =
        std::env::temp_dir().join(format!("lervo-core-link-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let program = directory.join("lervo");
    std::fs::copy(
        format!("{}/tests/fake-resident.sh", env!("CARGO_MANIFEST_DIR")),
        &program,
    )
    .unwrap();
    let starts = directory.join("starts");
    let _ = std::fs::remove_file(&starts);
    (program, starts)
}

fn following(program: &std::path::Path, starts: &std::path::Path) -> CoreLink {
    CoreLink::new(
        program.display().to_string(),
        vec![
            "current".to_owned(),
            String::new(),
            starts.display().to_string(),
        ],
    )
    .unwrap()
}

/// Installs a new version over `program`, as an upgrade rewrites the file the link points to.
fn upgrade(program: &std::path::Path) {
    let mut text = std::fs::read_to_string(program).unwrap();
    text.push_str("# upgraded\n");
    std::fs::write(program, text).unwrap();
}

fn started(starts: &std::path::Path) -> usize {
    std::fs::read_to_string(starts).map_or(0, |text| text.lines().count())
}

#[tokio::test]
async fn follows_an_upgraded_executable_at_the_next_base_command() {
    let (program, starts) = installed("upgrade");
    let core = following(&program, &starts);
    core.command("workspace.list", none()).await.unwrap();
    core.command("workspace.list", none()).await.unwrap();
    assert_eq!(started(&starts), 1);
    upgrade(&program);
    core.command("workspace.list", none()).await.unwrap();
    assert_eq!(started(&starts), 2);
    // The new process advertised its commands at once, so newer commands still reach it.
    assert!(core.command("provider.list", none()).await.is_ok());
    assert_eq!(started(&starts), 2);
}

#[tokio::test]
async fn keeps_the_process_while_a_turn_is_decoded() {
    let (program, starts) = installed("turn");
    let core = following(&program, &starts);
    let launch = core
        .command("workspace.start", arguments("go"))
        .await
        .unwrap()
        .launch
        .unwrap();
    let mut decoder = core.decoder(&launch);
    decoder.send("hi").await;
    upgrade(&program);
    core.command("workspace.list", none()).await.unwrap();
    assert_eq!(started(&starts), 1, "a turn in progress keeps the process");
    decoder.output(b"finish\n").await;
    core.command("workspace.list", none()).await.unwrap();
    assert_eq!(started(&starts), 2, "a finished turn lets it go");
}

#[tokio::test]
async fn keeps_the_old_process_when_the_new_executable_cannot_start() {
    use std::os::unix::fs::PermissionsExt;
    let (program, starts) = installed("broken");
    let core = following(&program, &starts);
    core.command("workspace.list", none()).await.unwrap();
    upgrade(&program);
    std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert!(core.command("workspace.list", none()).await.is_ok());
    assert_eq!(started(&starts), 1);
}
