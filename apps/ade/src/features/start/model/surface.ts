import { useWorkspaceStore, type Workspace } from "../../workspaces";
import { settleStart } from "./start";
import { type PendingStart, useStartStore } from "./store";

/**
 * What the main area shows: the start screen, the pending workspace of work just sent, or a
 * workspace. `key` changes only when the view becomes another one: a workspace that continues
 * the pending one keeps the pending key, so it replaces it in
 * place (ADE motion, "Starting work").
 */
export type Surface =
  | { readonly kind: "start"; readonly key: string; readonly background: "none" }
  | {
      readonly kind: "pending";
      readonly key: string;
      readonly background: "native";
      readonly pending: PendingStart;
    }
  | {
      readonly kind: "workspace";
      readonly key: string;
      readonly background: "native";
      readonly workspace: Workspace;
      /** The pending start this workspace continues, if it was just created from it. */
      readonly continuing: PendingStart | null;
    };

/** The surface for the selected workspace and the pending start. */
export function surfaceOf(selected: Workspace | undefined, pending: PendingStart | null): Surface {
  if (selected === undefined)
    return pending === null
      ? { kind: "start", key: "start", background: "none" }
      : { kind: "pending", key: `start-${pending.id}`, background: "native", pending };
  const continuing =
    pending !== null && pending.workspaceId === selected.workspaceId ? pending : null;
  return {
    kind: "workspace",
    key: continuing === null ? selected.workspaceId : `start-${continuing.id}`,
    background: "native",
    workspace: selected,
    continuing,
  };
}

/** The current surface, from the workspace and start stores. */
export function useSurface(): Surface {
  const selected = useWorkspaceStore((store) =>
    store.workspaces.find((workspace) => workspace.workspaceId === store.selected),
  );
  const pending = useStartStore((store) => store.pending);
  return surfaceOf(selected, pending);
}

/**
 * Settles the pending start when the user turns to new work or to a workspace other than the one
 * the start created. Returns the unsubscribe function.
 */
export function bindStart(): () => void {
  return useWorkspaceStore.subscribe((state, previous) => {
    const pending = useStartStore.getState().pending;
    if (pending === null) return;
    const newWork = state.newWorkRequests !== previous.newWorkRequests;
    const elsewhere =
      state.selected !== previous.selected &&
      state.selected !== null &&
      state.selected !== pending.workspaceId;
    if (newWork || elsewhere) settleStart();
  });
}
