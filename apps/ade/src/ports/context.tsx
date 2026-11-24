import { createContext, type ReactNode, useContext } from "react";

import type { Drafts } from "./drafts";
import type { ListCache } from "./lists";
import type { ApplicationCommands, SessionHost } from "./session-host";

/** The adapters the composition root gives the views. */
export interface Adapters {
  readonly host: SessionHost;
  readonly commands: ApplicationCommands;
  readonly drafts: Drafts;
  readonly lists: ListCache;
}

const AdaptersContext = createContext<Adapters | null>(null);

/** Gives the views their adapters; only the composition root renders it. */
export function AdaptersProvider(props: { adapters: Adapters; children: ReactNode }) {
  return <AdaptersContext value={props.adapters}>{props.children}</AdaptersContext>;
}

function useAdapters(): Adapters {
  const adapters = useContext(AdaptersContext);
  if (adapters === null) throw new Error("This component needs an AdaptersProvider.");
  return adapters;
}

/** The interface's one session-host connection. Views receive it, never create one. */
export function useSessionHost(): SessionHost {
  return useAdapters().host;
}

/** Application commands through the session host and the Lervo core. */
export function useApplicationCommands(): ApplicationCommands {
  return useAdapters().commands;
}

/** Where unsent text survives reloads. */
export function useDrafts(): Drafts {
  return useAdapters().drafts;
}

/** The lists kept from the last launch, which the workspace models refresh. */
export function useListCache(): ListCache {
  return useAdapters().lists;
}
