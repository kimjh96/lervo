import { useState } from "react";
import { FormattedMessage } from "react-intl";

import { useApplicationCommands, useSessionHostClient } from "../../../app/session-host-context";
import { switchConversationMode, useWorkspaceStore } from "../../workspaces";
import styles from "./WorkspaceHeader.module.css";

/** The selected workspace's title and branch, and the switch between conversation modes. */
export function WorkspaceHeader(props: { workspaceId: string }) {
  const client = useSessionHostClient();
  const commands = useApplicationCommands();
  const [switching, setSwitching] = useState(false);
  const workspace = useWorkspaceStore((store) =>
    store.workspaces.find((item) => item.workspaceId === props.workspaceId),
  );
  if (workspace === undefined) return null;
  const other = workspace.conversationMode === "native" ? "cli" : "native";
  const toggle = () => {
    setSwitching(true);
    void switchConversationMode({
      client,
      commands,
      workspaceId: workspace.workspaceId,
      mode: other,
    })
      .catch(() => undefined)
      .finally(() => setSwitching(false));
  };
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{workspace.title ?? workspace.branch}</h1>
      <p className={styles.meta}>
        <FormattedMessage
          id="workspace.meta"
          values={{ repository: workspace.repositoryName, branch: workspace.branch }}
        />
      </p>
      <button type="button" className={styles.mode} disabled={switching} onClick={toggle}>
        <FormattedMessage id={`workspace.mode.${other}`} />
      </button>
    </header>
  );
}
