import { create } from "zustand";

import type { ConnectionState, SessionHost } from "../../../ports";

/**
 * Whether the session host is older than the application and can be replaced, and the
 * replacement's progress. Only a newer application offers it; an older one leaves a newer session
 * host alone.
 */
export type HostUpdate =
  | { readonly kind: "none" }
  | { readonly kind: "available" }
  | { readonly kind: "restarting" }
  | { readonly kind: "failed"; readonly code: string };

interface ConnectionStore {
  readonly state: ConnectionState;
  readonly update: HostUpdate;
}

/** The connection's state, which only the session-host client changes, and the host update. */
export const useConnectionStore = create<ConnectionStore>(() => ({
  state: "connecting",
  update: { kind: "none" },
}));

/** Mirrors `client`'s connection state into the store; returns the unsubscribe function. */
export function bindConnection(client: Pick<SessionHost, "connection" | "onState">): () => void {
  useConnectionStore.setState({ state: client.connection });
  return client.onState((state) => useConnectionStore.setState({ state }));
}
