//! The commands the interface invokes. They only relay; every decision stays in the session host
//! and the Lervo core.

use lervo_session_protocol::ClientMessage;
use lervo_session_transport::client::ClientIdentity;
use lervo_session_transport::paths::Layout;
use serde_json::{Value, json};
use tauri::State;
use tauri::ipc::{Channel, InvokeBody, Request, Response};
use tokio::sync::Mutex;

use crate::host_link::{self, Event, Outgoing};
use crate::host_program::HostProgram;

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
        };
        // The reason names a transport or validation rule, never a message body.
        if let Err(error) = host_link::run(program, layout, identity, receiver, events).await {
            eprintln!("lervo: the session host connection ended: {error}");
        }
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

/// The header that names the terminal channel of `host_input`'s bytes.
const CHANNEL_HEADER: &str = "lervo-channel";

/// Sends keystrokes or pasted bytes to a CLI conversation's terminal channel. The bytes arrive
/// as the raw request body and the channel in the `lervo-channel` header, so input is never
/// encoded as JSON.
#[tauri::command]
pub async fn host_input(relay: State<'_, Relay>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("message_invalid".to_owned());
    };
    let channel = request
        .headers()
        .get(CHANNEL_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u32>().ok())
        .ok_or_else(|| "message_invalid".to_owned())?;
    let bytes = bytes.clone();
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
