import type { ImageMark } from "@lervo/session-host-contract";
import { create } from "zustand";

import type { AttachedFile, PreparedImage } from "../../../ports";
import type { StartDraft } from "./start";

/** Why a start failed, as the session host or the core reported it. */
export interface StartFailure {
  readonly code: string;
  readonly stage: string | null;
}

/**
 * Why the core started the work without something, such as from the local branch because the
 * upstream could not be fetched (Lervo ADE sessions, "The workspace's base").
 */
export interface BaseNotice {
  /** The core's notice, an open set; the conversation names the ones it knows. */
  readonly code: string;
  /** The upstream the core meant to start from, such as `origin/main`. */
  readonly upstream: string | null;
}

/** Work that was sent and whose workspace the core is still creating, or has just created. */
export interface PendingStart {
  /** Tells this start apart from a later one. */
  readonly id: number;
  readonly instruction: string;
  readonly repositoryName: string;
  /** The created workspace, once the core answered. */
  readonly workspaceId: string | null;
  /** What the created workspace started without, when the core said so. */
  readonly baseNotice: BaseNotice | null;
  /**
   * The core's code when the Product Owner the start card proposed could not be hired; the work
   * then starts without it, and its conversation says so.
   */
  readonly hireFailure: string | null;
  /**
   * The failed step's code when the core could not set up the work's coordination; the work then
   * writes without claiming its paths, and its conversation says so (Lervo ADE coordination).
   */
  readonly coordinationFailure: string | null;
  /** The images pasted with the instruction, as its first message shows them. */
  readonly images: readonly ImageMark[];
}

interface StartStore {
  readonly draft: StartDraft;
  readonly pending: PendingStart | null;
  /** The failure of the last start: the protocol code and, when the core named it, the stage. */
  readonly error: StartFailure | null;
  /** The images of a start that failed, which the start screen puts back with the instruction. */
  readonly returnedImages: readonly PreparedImage[];
  /** The files of a start that failed, which the start screen puts back too. */
  readonly returnedFiles: readonly AttachedFile[];
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
  returnedImages: [],
  returnedFiles: [],
}));
