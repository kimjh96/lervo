import { FormattedMessage } from "react-intl";

import { ConnectionStatus } from "../features/connection";
import { WorkspaceConversation } from "../features/conversation";
import { StartScreen } from "../features/start";
import { WorkspaceHeader } from "../features/workspace-header";
import { useWorkspaceStore, WorkspaceList } from "../features/workspaces";
import styles from "./Frame.module.css";
import { LogoMark } from "./LogoMark";

/** The window's layout: the workspace list beside the start screen or the selected workspace. */
export function Frame() {
  const selected = useWorkspaceStore((store) =>
    store.workspaces.find((workspace) => workspace.workspaceId === store.selected),
  );
  return (
    <div className={styles.frame}>
      <nav className={styles.sidebar}>
        <header className={styles.brand}>
          <LogoMark size={18} />
          <span className={styles.name}>
            <FormattedMessage id="app.name" />
          </span>
        </header>
        <WorkspaceList />
        <div className={styles.footer}>
          <ConnectionStatus />
        </div>
      </nav>
      <main className={styles.content}>
        {selected === undefined ? (
          <StartScreen />
        ) : (
          <>
            <WorkspaceHeader workspaceId={selected.workspaceId} />
            {selected.conversationMode === "native" ? (
              <WorkspaceConversation
                key={selected.workspaceId}
                target={{ workspaceId: selected.workspaceId, sessionId: selected.sessionId }}
              />
            ) : (
              <p className={styles.pending}>
                <FormattedMessage id="conversation.cliPending" />
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
