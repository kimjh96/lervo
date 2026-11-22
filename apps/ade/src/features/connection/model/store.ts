import { create } from "zustand";

import type { ConnectionState, SessionHostClient } from "../../../platform/session-host";

interface ConnectionStore {
  readonly state: ConnectionState;
}

/** The connection's state, which only the session-host client changes. */
export const useConnectionStore = create<ConnectionStore>(() => ({ state: "connecting" }));

/** Mirrors `client`'s connection state into the store; returns the unsubscribe function. */
export function bindConnection(client: SessionHostClient): () => void {
  useConnectionStore.setState({ state: client.connection });
  return client.onState((state) => useConnectionStore.setState({ state }));
}
