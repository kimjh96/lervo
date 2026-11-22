import { createContext, type ReactNode, useContext } from "react";

import type { ApplicationCommands, SessionHostClient } from "../platform/session-host";

interface SessionHost {
  readonly client: SessionHostClient;
  readonly commands: ApplicationCommands;
}

const SessionHostContext = createContext<SessionHost | null>(null);

export function SessionHostProvider(props: SessionHost & { children: ReactNode }) {
  return (
    <SessionHostContext value={{ client: props.client, commands: props.commands }}>
      {props.children}
    </SessionHostContext>
  );
}

function useSessionHost(): SessionHost {
  const host = useContext(SessionHostContext);
  if (host === null) throw new Error("This component needs a SessionHostProvider.");
  return host;
}

/** The interface's one session-host client. Features receive it, never create one. */
export function useSessionHostClient(): SessionHostClient {
  return useSessionHost().client;
}

/** Application commands through the session host and the Lervo core. */
export function useApplicationCommands(): ApplicationCommands {
  return useSessionHost().commands;
}
