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
    let path = format!("{}/tests/{program}", env!("CARGO_MANIFEST_DIR"));
    CoreLink::new(path, Vec::new()).unwrap()
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
    let missing = core.open("wsp_2").await.unwrap_err();
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
    };
    let (input, shown) = core.decoder(&launch).send("hi").await;
    assert!(input.is_empty());
    assert!(
        matches!(&shown[..], [Decoded::Conversation(Input::Item { content: Content::LervoNotice { code, .. }, .. })] if code == "core_link_unavailable")
    );
}
