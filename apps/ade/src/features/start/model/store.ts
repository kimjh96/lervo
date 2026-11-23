import { create } from "zustand";

import type { StartDraft } from "./start";

/** Why a start failed, as the session host or the core reported it. */
export interface StartFailure {
  readonly code: string;
  readonly stage: string | null;
}

/** Work that was sent and whose workspace the core is still creating, or has just created. */
export interface PendingStart {
  /** Tells this start apart from a later one. */
  readonly id: number;
  readonly instruction: string;
  readonly repositoryName: string;
  /** The created workspace, once the core answered. */
  readonly workspaceId: string | null;
}

interface StartStore {
  readonly draft: StartDraft;
  readonly pending: PendingStart | null;
  /** The failure of the last start: the protocol code and, when the core named it, the stage. */
  readonly error: StartFailure | null;
}

/**
 * The start screen's state. It outlives the screen, which gives way to the pending workspace as
 * soon as work is sent and returns, with the instruction, if the start fails.
 */
export const useStartStore = create<StartStore>(() => ({
  // No provider until the user chooses one; the start screen offers the core's default.
  draft: { instruction: "", repository: "", provider: "" },
  pending: null,
  error: null,
}));
