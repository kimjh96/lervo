import { lazy, Suspense } from "react";

import { ConnectionStatus } from "../features/connection";
import { WorkspaceConversation } from "../features/conversation";
import { StartScreen } from "../features/start";
import { WorkspaceHeader } from "../features/workspace-header";
import { useWorkspaceStore, WorkspaceList } from "../features/workspaces";
import styles from "./Frame.module.css";

// The terminal and its renderer load on first use, so the start screen stays light.
const Terminal = lazy(() =>
  import("../features/terminal").then((module) => ({ default: module.Terminal })),
);

/**
 * The window (approved mockups "1" and "2a/2b"): the workspace list beside the start screen or
 * the selected workspace. Changing the view fades the new one in over `change`; nothing slides
 * (ADE motion, "Switching workspaces").
 */
export function Frame() {
  const selected = useWorkspaceStore((store) =>
    store.workspaces.find((workspace) => workspace.workspaceId === store.selected),
  );
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
        key={
          selected === undefined ? "start" : `${selected.workspaceId}:${selected.conversationMode}`
        }
        className={styles.content}
        data-view={selected === undefined ? "start" : selected.conversationMode}
      >
        {selected === undefined ? (
          <>
            <div className={styles.titlebar} data-tauri-drag-region />
            <StartScreen />
          </>
        ) : (
          <>
            <WorkspaceHeader workspaceId={selected.workspaceId} />
            {selected.conversationMode === "native" ? (
              <WorkspaceConversation
                target={{ workspaceId: selected.workspaceId, sessionId: selected.sessionId }}
              />
            ) : (
              <Suspense fallback={null}>
                <Terminal workspaceId={selected.workspaceId} />
              </Suspense>
            )}
          </>
        )}
      </main>
    </div>
  );
}
