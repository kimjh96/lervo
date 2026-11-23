import { lazy, Suspense, useEffect } from "react";

import { ConnectionStatus } from "../features/connection";
import { WorkspaceConversation } from "../features/conversation";
import { PendingWorkspace, settleStart, StartScreen, useStartStore } from "../features/start";
import { WorkspaceHeader } from "../features/workspace-header";
import { useWorkspaceStore, WorkspaceList } from "../features/workspaces";
import styles from "./Frame.module.css";

// The terminal and its renderer load on first use, so the start screen stays light.
const Terminal = lazy(() =>
  import("../features/terminal").then((module) => ({ default: module.Terminal })),
);

/**
 * The window (approved mockups "1" and "2a/2b"): the workspace list beside the start screen or
 * the selected workspace. Views change in continuity transitions, which the actions that change
 * them start (ADE motion, "Continuity between views"). Work just sent shows its pending workspace
 * at once, and the created workspace continues it in the same view.
 */
export function Frame() {
  const selected = useWorkspaceStore((store) =>
    store.workspaces.find((workspace) => workspace.workspaceId === store.selected),
  );
  const newWorkRequests = useWorkspaceStore((store) => store.newWorkRequests);
  const pending = useStartStore((store) => store.pending);
  const continuing =
    pending !== null &&
    pending.workspaceId !== null &&
    selected?.workspaceId === pending.workspaceId;

  // Turning to another workspace, or to new work, settles the pending start.
  useEffect(() => {
    if (pending !== null && selected !== undefined && selected.workspaceId !== pending.workspaceId)
      settleStart();
  }, [pending, selected]);
  useEffect(() => settleStart(), [newWorkRequests]);

  const view =
    pending !== null && (selected === undefined || continuing)
      ? `start-${pending.id}`
      : selected === undefined
        ? "start"
        : `${selected.workspaceId}:${selected.conversationMode}`;

  return (
    <div className={styles.frame}>
      <nav className={styles.sidebar}>
        {/* The macOS window controls sit over this strip, which also moves the window. */}
        <div className={styles.titlebar} data-tauri-drag-region />
        <WorkspaceList />
        <div className={styles.footer}>
          <ConnectionStatus />
        </div>
      </nav>
      <main
        key={view}
        className={styles.content}
        data-view={selected?.conversationMode ?? (pending === null ? "start" : "native")}
      >
        {selected !== undefined ? (
          <>
            <WorkspaceHeader workspaceId={selected.workspaceId} continues={continuing} />
            {selected.conversationMode === "native" ? (
              <WorkspaceConversation
                target={{
                  workspaceId: selected.workspaceId,
                  sessionId: selected.sessionId,
                  ...(continuing ? { firstMessage: pending.instruction } : {}),
                }}
              />
            ) : (
              <Suspense fallback={null}>
                <Terminal workspaceId={selected.workspaceId} />
              </Suspense>
            )}
          </>
        ) : pending !== null ? (
          <PendingWorkspace pending={pending} />
        ) : (
          <>
            <div className={styles.titlebar} data-tauri-drag-region />
            <StartScreen />
          </>
        )}
      </main>
    </div>
  );
}
