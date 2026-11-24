import { FormattedMessage, useIntl } from "react-intl";

import { Waiting } from "../../../ui/Waiting";
import { useConnectionStore } from "../model/store";
import styles from "./ConnectionStatus.module.css";

const waitingMessages = {
  connecting: { id: "connection.connecting" },
  reconnecting: { id: "connection.reconnecting" },
} as const;

/**
 * The connection to this computer's session host, shown only while it is not connected. Reaching
 * it is a wait, named like every other (ADE design patterns, "Waiting"); the first connection
 * waits longer before it says so, because the start screen shows the lists kept from the last
 * launch meanwhile. A session host that cannot start is a failure, and it stays still.
 */
export function ConnectionStatus() {
  const intl = useIntl();
  const state = useConnectionStore((store) => store.state);
  if (state === "connected") return null;
  if (state === "unavailable")
    return (
      <p className={styles.status} role="status" data-state={state}>
        <FormattedMessage id="connection.unavailable" />
      </p>
    );
  return (
    <Waiting
      key={state}
      className={styles.status}
      label={intl.formatMessage(waitingMessages[state])}
      launch={state === "connecting"}
    />
  );
}
