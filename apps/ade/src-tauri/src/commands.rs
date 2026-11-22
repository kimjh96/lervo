//! The commands the interface invokes. They only relay; every decision stays in the session host
//! and the Lervo core.

use lervo_session_protocol::ClientMessage;
use lervo_session_transport::client::ClientIdentity;
use lervo_session_transport::paths::Layout;
use serde_json::{Value, json};
use tauri::State;
use tauri::ipc::{Channel, Response};
use tokio::sync::Mutex;

use crate::host_link::{self, Event, HostProgram, Outgoing};

/// The relay's state: how to reach the session host, and the queue of the live connection.
pub struct Relay {
    pub program: Option<HostProgram>,
    pub layout: Option<Layout>,
    pub outgoing: Mutex<Option<tokio::sync::mpsc::Sender<Outgoing>>>,
}

/// Connects to the session host and streams its messages to `control` and its terminal frames
/// to `terminal`. `{"kind": "host.disconnected"}` on `control` ends each connection; the
/// interface then calls this again.
#[tauri::command]
pub async fn host_connect(
    relay: State<'_, Relay>,
    control: Channel<Value>,
    terminal: Channel<Response>,
) -> Result<(), String> {
    let (Some(program), Some(layout)) = (relay.program.clone(), relay.layout.clone()) else {
        return Err("session_host_unavailable".to_owned());
    };
    let (sender, receiver) = host_link::outgoing_queue();
    *relay.outgoing.lock().await = Some(sender);
    let identity = ClientIdentity {
        name: "lervo-ade".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
    };
    let disconnected = control.clone();
    tauri::async_runtime::spawn(async move {
        let events = move |event| match event {
            Event::Control(message) => {
                if let Ok(value) = serde_json::to_value(message) {
                    let _ = control.send(value);
                }
            }
            Event::Terminal(frame) => {
                let _ = terminal.send(Response::new(frame));
            }
            Event::Disconnected => {}
        };
        let _ = host_link::run(program, layout, identity, receiver, events).await;
        let _ = disconnected.send(json!({ "kind": "host.disconnected" }));
    });
    Ok(())
}

/// Sends one control message. The session host validates it again on receipt.
#[tauri::command]
pub async fn host_send(relay: State<'_, Relay>, message: Value) -> Result<(), String> {
    let message: ClientMessage =
        serde_json::from_value(message).map_err(|_| "message_invalid".to_owned())?;
    send(&relay, Outgoing::Control(message)).await
}

/// Sends keystrokes or pasted bytes to a CLI conversation's terminal channel.
#[tauri::command]
pub async fn host_input(
    relay: State<'_, Relay>,
    channel: u32,
    bytes: Vec<u8>,
) -> Result<(), String> {
    send(&relay, Outgoing::Terminal { channel, bytes }).await
}

async fn send(relay: &Relay, item: Outgoing) -> Result<(), String> {
    let sender = relay.outgoing.lock().await.clone();
    match sender {
        Some(sender) => sender
            .send(item)
            .await
            .map_err(|_| "session_host_unavailable".to_owned()),
        None => Err("session_host_unavailable".to_owned()),
    }
}
