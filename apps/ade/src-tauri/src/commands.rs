//! The commands the interface invokes. They only relay; every decision stays in the session host
//! and the Lervo core.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as SyncMutex};

use lervo_session_protocol::ClientMessage;
use lervo_session_transport::client::ClientIdentity;
use lervo_session_transport::paths::Layout;
use serde_json::{Value, json};
use tauri::State;
use tauri::ipc::Channel;
use tokio::sync::Mutex;

use crate::host_link::{self, Event, Outgoing};
use crate::host_program::HostProgram;

/// The relay's state: how to reach the session host, the queue of the live connection, and the
/// session host process that connection reached, with the connection's number.
pub struct Relay {
    pub program: Option<HostProgram>,
    pub layout: Option<Layout>,
    pub outgoing: Mutex<Option<tokio::sync::mpsc::Sender<Outgoing>>>,
    pub peer: Arc<SyncMutex<Option<(u64, i32)>>>,
    pub connections: AtomicU64,
}

impl Relay {
    pub fn new(program: Option<HostProgram>, layout: Option<Layout>) -> Self {
        Self {
            program,
            layout,
            outgoing: Mutex::new(None),
            peer: Arc::new(SyncMutex::new(None)),
            connections: AtomicU64::new(0),
        }
    }
}

/// Records the session host process of connection `connection`, or forgets it when the
/// connection that recorded it ends; a newer connection's process stays.
fn note_peer(peer: &SyncMutex<Option<(u64, i32)>>, connection: u64, process: Option<i32>) {
    if let Ok(mut current) = peer.lock() {
        match process {
            Some(process) => *current = Some((connection, process)),
            None if current.is_some_and(|(owner, _)| owner == connection) => *current = None,
            None => {}
        }
    }
}

/// Connects to the session host and streams its messages to `control`. After the handshake,
/// `{"kind": "host.identified"}` names the session host's version and the shell's, and whether
/// `host_replace` can end it. `{"kind": "host.disconnected"}` ends each connection; the interface
/// then calls this again.
#[tauri::command]
pub async fn host_connect(relay: State<'_, Relay>, control: Channel<Value>) -> Result<(), String> {
    let (Some(program), Some(layout)) = (relay.program.clone(), relay.layout.clone()) else {
        return Err("session_host_unavailable".to_owned());
    };
    let (sender, receiver) = host_link::outgoing_queue();
    *relay.outgoing.lock().await = Some(sender);
    let identity = ClientIdentity {
        name: "lervo-ade".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
    };
    let connection = relay.connections.fetch_add(1, Ordering::Relaxed) + 1;
    let (peer, ended_peer) = (Arc::clone(&relay.peer), Arc::clone(&relay.peer));
    let disconnected = control.clone();
    tauri::async_runtime::spawn(async move {
        let events = move |event| match event {
            Event::Identified(facts) => {
                note_peer(&peer, connection, facts.process);
                let _ = control.send(json!({
                    "kind": "host.identified",
                    "hostVersion": facts.version,
                    "appVersion": env!("CARGO_PKG_VERSION"),
                    "replaceable": facts.process.is_some(),
                }));
            }
            Event::Control(message) => {
                if let Ok(value) = serde_json::to_value(message) {
                    let _ = control.send(value);
                }
            }
        };
        // The reason names a transport or validation rule, never a message body.
        if let Err(error) = host_link::run(program, layout, identity, receiver, events).await {
            eprintln!("lervo: the session host connection ended: {error}");
        }
        note_peer(&ended_peer, connection, None);
        let _ = disconnected.send(json!({ "kind": "host.disconnected" }));
    });
    Ok(())
}

/// Ends the session host the live connection reached, with its sessions, so that the next
/// connection starts the session host beside the shell. The interface asks the user first.
#[tauri::command]
pub fn host_replace(relay: State<'_, Relay>) -> Result<(), String> {
    let peer = relay.peer.lock().ok().and_then(|mut peer| peer.take());
    let (_, process) = peer.ok_or("host_replace_unavailable")?;
    crate::host_program::terminate(process).map_err(|_| "host_replace_failed".to_owned())
}

/// Sends one control message. The session host validates it again on receipt.
#[tauri::command]
pub async fn host_send(relay: State<'_, Relay>, message: Value) -> Result<(), String> {
    let message: ClientMessage =
        serde_json::from_value(message).map_err(|_| "message_invalid".to_owned())?;
    send(&relay, Outgoing::Control(message)).await
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

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::note_peer;

    #[test]
    fn an_ended_connection_forgets_only_its_own_process() {
        let peer = Mutex::new(None);
        note_peer(&peer, 1, Some(100));
        note_peer(&peer, 2, Some(200));
        note_peer(&peer, 1, None);
        assert_eq!(
            *peer.lock().unwrap_or_else(|e| e.into_inner()),
            Some((2, 200))
        );
        note_peer(&peer, 2, None);
        assert_eq!(*peer.lock().unwrap_or_else(|e| e.into_inner()), None);
    }
}
