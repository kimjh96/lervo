import { FormattedMessage } from "react-intl";

import { useConnectionStore } from "../model/store";
import styles from "./ConnectionStatus.module.css";

const messageIds = {
  connecting: "connection.connecting",
  connected: "connection.connected",
  reconnecting: "connection.reconnecting",
  unavailable: "connection.unavailable",
} as const;

/** The connection to this computer's session host, shown only while it is not connected. */
export function ConnectionStatus() {
  const state = useConnectionStore((store) => store.state);
  if (state === "connected") return null;
  return (
    <p className={styles.status} role="status" data-state={state}>
      <FormattedMessage id={messageIds[state]} />
    </p>
  );
}
