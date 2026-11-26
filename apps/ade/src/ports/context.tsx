import { createContext, type ReactNode, useContext } from "react";

import type { Clipboard } from "./clipboard";
import type { Drafts } from "./drafts";
import type { Files } from "./files";
import type { Images } from "./images";
import type { ListCache } from "./lists";
import type { ApplicationCommands, HostReplacement, SessionHost } from "./session-host";

/** The adapters the composition root gives the views. */
export interface Adapters {
  readonly host: SessionHost;
  readonly replacement: HostReplacement;
  readonly commands: ApplicationCommands;
  readonly drafts: Drafts;
  readonly lists: ListCache;
  readonly clipboard: Clipboard;
  readonly images: Images;
  readonly files: Files;
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

/** The reached session host's identity, and its replacement by the shell's own. */
export function useHostReplacement(): HostReplacement {
  return useAdapters().replacement;
}

/** Application commands through the session host and the Lervo core. */
export function useApplicationCommands(): ApplicationCommands {
  return useAdapters().commands;
}

/** The system clipboard. */
export function useClipboard(): Clipboard {
  return useAdapters().clipboard;
}

/** Prepares pasted images for a message. */
export function useImages(): Images {
  return useAdapters().images;
}

/** Files attached to a message by path. */
export function useFiles(): Files {
  return useAdapters().files;
}

/** Where unsent text survives reloads. */
export function useDrafts(): Drafts {
  return useAdapters().drafts;
}

/** The lists kept from the last launch, which the workspace models refresh. */
export function useListCache(): ListCache {
  return useAdapters().lists;
}
