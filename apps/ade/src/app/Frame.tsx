import { ConnectionStatus, HostUpdateNotice } from "../features/connection";
import { WorkspaceConversation } from "../features/conversation";
import { PendingWorkspace, StartScreen, type Surface, useSurface } from "../features/start";
import { WorkspaceHeader } from "../features/workspace-header";
import { WorkspaceList } from "../features/workspaces";
import styles from "./Frame.module.css";

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
  return (
    <>
      <WorkspaceHeader
        workspaceId={surface.workspace.workspaceId}
        continues={surface.continuing !== null}
      />
      {/* The ADE shows the native conversation only (ADR-0617). A workspace last opened in the
          provider's terminal reopens its session in the native conversation. */}
      <WorkspaceConversation
        workspaceId={surface.workspace.workspaceId}
        sessionId={surface.workspace.sessionId}
        firstMessage={surface.continuing?.instruction}
        reopenNatively={surface.workspace.conversationMode !== "native"}
      />
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
          <HostUpdateNotice />
        </div>
      </nav>
      <main key={surface.key} className={styles.content} data-background={surface.background}>
        <Main surface={surface} />
      </main>
    </div>
  );
}
