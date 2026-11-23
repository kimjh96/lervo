import type { ConversationMode } from "@lervo/session-host-contract";
import { type ComponentType, lazy, Suspense } from "react";

import { ConnectionStatus } from "../features/connection";
import { WorkspaceConversation } from "../features/conversation";
import { PendingWorkspace, StartScreen, type Surface, useSurface } from "../features/start";
import { WorkspaceHeader } from "../features/workspace-header";
import { WorkspaceList } from "../features/workspaces";
import styles from "./Frame.module.css";

// The terminal and its renderer load on first use, so the start screen stays light.
const Terminal = lazy(() =>
  import("../features/terminal").then((module) => ({ default: module.Terminal })),
);

type WorkspaceSurface = Extract<Surface, { kind: "workspace" }>;

/** The view of each conversation mode. */
const conversationViews: Record<ConversationMode, ComponentType<{ surface: WorkspaceSurface }>> = {
  native: ({ surface }) => (
    <WorkspaceConversation
      workspaceId={surface.workspace.workspaceId}
      sessionId={surface.workspace.sessionId}
      firstMessage={surface.continuing?.instruction}
    />
  ),
  cli: ({ surface }) => (
    <Suspense fallback={null}>
      <Terminal workspaceId={surface.workspace.workspaceId} />
    </Suspense>
  ),
};

function Main(props: { surface: Surface }) {
  const { surface } = props;
  if (surface.kind === "start")
    return (
      <>
        <div className={styles.titlebar} data-tauri-drag-region />
        <StartScreen />
      </>
    );
  if (surface.kind === "pending") return <PendingWorkspace pending={surface.pending} />;
  const Conversation = conversationViews[surface.workspace.conversationMode];
  return (
    <>
      <WorkspaceHeader
        workspaceId={surface.workspace.workspaceId}
        continues={surface.continuing !== null}
      />
      <Conversation surface={surface} />
    </>
  );
}

/**
 * The window (approved mockups "1" and "2a/2b"): the workspace list beside the main area, which
 * shows what `useSurface` decides. It only wires views to the surface.
 */
export function Frame() {
  const surface = useSurface();
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
      <main key={surface.key} className={styles.content} data-background={surface.background}>
        <Main surface={surface} />
      </main>
    </div>
  );
}
