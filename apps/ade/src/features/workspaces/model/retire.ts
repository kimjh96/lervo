import {
  type ApplicationCommands,
  type ListCache,
  RequestFailure,
  type SessionHost,
} from "../../../ports";
import { create } from "zustand";

import { reloadWorkspaces } from "./controller";
import { useWorkspaceStore } from "./store";

/**
 * The changes the last removal kept, with the Git command that brings them back, which the start
 * screen shows until the person dismisses it or removes another workspace.
 */
export const useKeptChanges = create<{
  restore: string | null;
  dismiss: () => void;
}>((set) => ({ restore: null, dismiss: () => set({ restore: null }) }));

/** How long a stopped session may take to end: the session host's 8 s grace, with room. */
const STOP_WAIT_MS = 15_000;

/** Resolves when the session reports `ended`, or rejects with `session_stop_timeout`. */
function ended(host: SessionHost, sessionId: string): { done: Promise<void>; cancel: () => void } {
  let cancel = () => undefined as void;
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new RequestFailure("session_stop_timeout"));
    }, STOP_WAIT_MS);
    const unsubscribe = host.onMessage((message) => {
      if (message.kind !== "session.status" || message.sessionId !== sessionId) return;
      if (message.status !== "ended") return;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    });
    cancel = () => {
      clearTimeout(timer);
      unsubscribe();
    };
  });
  return { done, cancel };
}

/** Stops one of the workspace's sessions and waits until it ends; one that does not run is done. */
async function stopSession(host: SessionHost, sessionId: string): Promise<void> {
  const status = useWorkspaceStore.getState().statuses[sessionId];
  if (status === undefined || status === "ended") return;
  const wait = ended(host, sessionId);
  try {
    await host.post({ kind: "session.stop", sessionId });
  } catch (failure) {
    wait.cancel();
    if (failure instanceof RequestFailure && failure.code === "session_not_found") return;
    throw failure;
  }
  await wait.done;
}

/** The step a retirement is on, so the interface can name what Lervo is doing. */
export type RetireStep = "stopping" | "removing";

/**
 * Retires a workspace (Lervo ADE sessions, "Retiring a workspace"): it stops its sessions, asks
 * the core to remove the workspace, which refuses one with changes, and returns to the start
 * screen. `onStep` hears each step as it begins. A failure rejects with the `RequestFailure`,
 * whose `coreCode` parameter names the core's refusal.
 */
export async function retireWorkspace(input: {
  host: SessionHost;
  commands: ApplicationCommands;
  lists: ListCache;
  workspaceId: string;
  /** Removes the workspace with its uncommitted changes, which the core keeps a copy of first. */
  discardChanges?: boolean;
  onStep?: (step: RetireStep) => void;
}): Promise<void> {
  const workspace = useWorkspaceStore
    .getState()
    .workspaces.find((item) => item.workspaceId === input.workspaceId);
  if (workspace === undefined) return;
  // The lead's session and every agent's that joined: any of them still running in the worktree
  // makes the core refuse with `workspace_in_use`.
  const sessionIds = [
    ...new Set([workspace.sessionId, ...(workspace.sessions ?? []).map((item) => item.sessionId)]),
  ];
  const statuses = useWorkspaceStore.getState().statuses;
  if (sessionIds.some((id) => statuses[id] !== undefined && statuses[id] !== "ended"))
    input.onStep?.("stopping");
  await Promise.all(sessionIds.map((sessionId) => stopSession(input.host, sessionId)));
  input.onStep?.("removing");
  const result = await input.commands.run("workspace.retire", {
    workspaceId: input.workspaceId,
    ...(input.discardChanges === true ? { discardChanges: true } : {}),
  });
  useKeptChanges.setState({ restore: result.keptChanges?.restore ?? null });
  const store = useWorkspaceStore.getState();
  if (store.selected === input.workspaceId) store.select(null);
  await reloadWorkspaces(input.commands, input.lists).catch(() => undefined);
}
