import { createContext, type ReactNode, useContext } from "react";

import type { SessionHostClient } from "../platform/session-host";

const SessionHostContext = createContext<SessionHostClient | null>(null);

export function SessionHostProvider(props: { client: SessionHostClient; children: ReactNode }) {
  return <SessionHostContext value={props.client}>{props.children}</SessionHostContext>;
}

/** The interface's one session-host client. Features receive it, never create one. */
export function useSessionHostClient(): SessionHostClient {
  const client = useContext(SessionHostContext);
  if (client === null) throw new Error("useSessionHostClient needs a SessionHostProvider.");
  return client;
}
