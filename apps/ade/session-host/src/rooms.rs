//! Deliveries between a conversation's agents (Lervo ADE rooms, "The core link and the session
//! host"): a native session's mention reaches the mentioned agent's session, which joins the
//! conversation first when it has none.

use std::collections::BTreeMap;
use std::sync::Arc;

use lervo_session_core::ports::{CommandOutcome, Core, RoomDelivery};
use lervo_session_core::transcript::NoticeValue;
use serde_json::{Map, Value};
use tokio::sync::mpsc;

use crate::diagnostics::Field;
use crate::host::Host;
use crate::lifecycle::Role;
use crate::messages;
use crate::session::{Command, SessionHandle};

impl<C: Core> Host<C> {
    /// Performs the deliveries native sessions send, one at a time and in order, for as long as
    /// the host serves.
    pub(crate) async fn deliver_all(
        self: Arc<Self>,
        mut delivered: mpsc::UnboundedReceiver<RoomDelivery>,
    ) {
        while let Some(delivery) = delivered.recv().await {
            self.deliver(delivery).await;
        }
    }

    /// The session's handle while its provider process runs.
    fn running_session(&self, session: &str) -> Option<SessionHandle> {
        let session = messages::identifier(session)?;
        self.registry()
            .sessions
            .get(&session)
            .filter(|handle| handle.is_running())
            .cloned()
    }

    /// Gives the delivered turn to the agent's running session, or joins the agent first. A
    /// delivery that fails shows as a line in the session whose mention set it off.
    async fn deliver(&self, delivery: RoomDelivery) {
        let deliver = |delivery: &RoomDelivery| Command::Deliver {
            delivery_id: delivery.delivery_id.clone(),
            text: delivery.text.clone(),
        };
        if let Some(handle) = delivery
            .session_id
            .as_deref()
            .and_then(|id| self.running_session(id))
        {
            handle.send(deliver(&delivery)).await;
            return;
        }
        let mut arguments = Map::new();
        arguments.insert(
            "workspaceId".into(),
            Value::from(delivery.workspace_id.as_str()),
        );
        arguments.insert("agentId".into(), Value::from(delivery.agent_id.as_str()));
        arguments.insert("instruction".into(), Value::from(delivery.text.as_str()));
        let code = match self.core.command("room.join", arguments).await {
            Ok(CommandOutcome {
                launch: Some(launch),
                ..
            }) => {
                // The agent's session may already run, such as when it joined meanwhile.
                if let Some(handle) = self.running_session(&launch.session_id) {
                    handle.send(deliver(&delivery)).await;
                    return;
                }
                // A new session starts from the delivered turn; a resumed one receives it.
                let initial = launch
                    .initial_input
                    .is_some()
                    .then(|| delivery.delivery_id.clone());
                let resumed = initial.is_none();
                let started = match messages::identifier(&delivery.delivery_id) {
                    Some(request) => {
                        let _serial = self.lifecycle.lock().await;
                        let role = Role::Member {
                            initial_delivery: initial,
                        };
                        self.start_as(&request, &launch, role).await;
                        self.running_session(&launch.session_id)
                    }
                    None => None,
                };
                match started {
                    Some(handle) => {
                        self.diagnostics.record(
                            "room.joined",
                            &[("session", Field::Code(&launch.session_id))],
                        );
                        if resumed {
                            handle.send(deliver(&delivery)).await;
                        }
                        return;
                    }
                    None => "room_session_unavailable".to_owned(),
                }
            }
            Ok(_) => "room_session_unavailable".to_owned(),
            // The core's own code, such as `mention_target_inactive`, names the cause best.
            Err(failure) => failure
                .core_code
                .clone()
                .or_else(|| failure.reason.map(str::to_owned))
                .unwrap_or_else(|| "room_session_unavailable".to_owned()),
        };
        self.diagnostics
            .record("room.delivery_failed", &[("code", Field::Code(&code))]);
        let source = delivery
            .source_session_id
            .as_deref()
            .and_then(|id| self.running_session(id));
        if let Some(source) = source {
            let parameters = BTreeMap::from([("code".to_owned(), NoticeValue::Text(code))]);
            source
                .send(Command::Notice {
                    code: "room_delivery_failed".to_owned(),
                    parameters,
                })
                .await;
        }
    }
}
