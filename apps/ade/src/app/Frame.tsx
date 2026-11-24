import { ConnectionStatus, HostUpdateNotice } from "../features/connection";
import { WorkspaceConversation } from "../features/conversation";
import { StartScreen, type Surface, useSurface } from "../features/start";
import { WorkspaceHeader } from "../features/workspace-header";
import { WorkspaceList } from "../features/workspaces";
import { ViewPresence } from "../ui/ViewPresence";
import styles from "./Frame.module.css";

function Main(props: { surface: Surface }) {
  const { surface } = props;
  if (surface.kind === "start")
    return (
      <div className={styles.view} data-background={surface.background}>
        <div className={styles.titlebar} data-tauri-drag-region />
        <StartScreen />
      </div>
    );
  // Work just sent and the workspace it creates are one view, so only what differs changes, in
  // place (ADE motion, "Starting work from the start screen").
  const workspace = surface.kind === "workspace" ? surface.workspace : null;
  const starting = surface.kind === "pending" ? surface.pending : surface.continuing;
  return (
    <div className={styles.view} data-background={surface.background}>
      <WorkspaceHeader
        workspaceId={workspace?.workspaceId ?? null}
        starting={
          starting === null
            ? null
            : {
                title: starting.instruction.split("\n")[0] ?? "",
                repositoryName: starting.repositoryName,
              }
        }
      />
      {/* The ADE shows the native conversation only (ADR-0617). A workspace last opened in the
          provider's terminal reopens its session in the native conversation. */}
      <WorkspaceConversation
        workspaceId={workspace?.workspaceId ?? null}
        sessionId={workspace?.sessionId ?? null}
        firstMessage={starting?.instruction}
        reopenNatively={workspace !== null && workspace.conversationMode !== "native"}
        baseNotice={starting?.baseNotice ?? null}
      />
    </div>
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
      <main className={styles.content}>
        <ViewPresence view={surface.key}>
          <Main surface={surface} />
        </ViewPresence>
      </main>
    </div>
  );
}
