import { FormattedMessage, type MessageDescriptor } from "react-intl";

import type { ConnectionState } from "../../../ports";
import { useConnectionStore } from "../model/store";
import styles from "./ConnectionStatus.module.css";

const stateMessages: Readonly<Record<ConnectionState, MessageDescriptor>> = {
  connecting: { id: "connection.connecting" },
  connected: { id: "connection.connected" },
  reconnecting: { id: "connection.reconnecting" },
  unavailable: { id: "connection.unavailable" },
};

/** The connection to this computer's session host, shown only while it is not connected. */
export function ConnectionStatus() {
  const state = useConnectionStore((store) => store.state);
  if (state === "connected") return null;
  return (
    <p className={styles.status} role="status" data-state={state}>
      <FormattedMessage {...stateMessages[state]} />
    </p>
  );
}
