import { useEffect, useState } from "react";
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

/**
 * How long the first connection may take before the frame says it is connecting. The start
 * screen can show the lists kept from the last launch before the session host answers, and a
 * notice that flashes for a few frames would only distract.
 */
const CONNECTING_NOTICE_AFTER_MS = 1000;

/** The connection to this computer's session host, shown only while it is not connected. */
export function ConnectionStatus() {
  const state = useConnectionStore((store) => store.state);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (state !== "connecting") return;
    const timer = setTimeout(() => setSlow(true), CONNECTING_NOTICE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [state]);
  if (state === "connected" || (state === "connecting" && !slow)) return null;
  return (
    <p className={styles.status} role="status" data-state={state}>
      <FormattedMessage {...stateMessages[state]} />
    </p>
  );
}
