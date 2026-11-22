import { FormattedMessage } from "react-intl";

import { ConnectionStatus } from "../features/connection";
import { StartScreen } from "../features/start";
import { WorkspaceList } from "../features/workspaces";
import styles from "./Frame.module.css";
import { LogoMark } from "./LogoMark";

/** The window's layout: the workspace list beside the conversation area. */
export function Frame() {
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
        <StartScreen />
      </main>
    </div>
  );
}
