import { FormattedMessage } from "react-intl";

import { useWorkspaceStore } from "../../workspaces";
import styles from "./WorkspaceHeader.module.css";

/** The selected workspace's title and branch. S1.5c adds its conversation below. */
export function WorkspaceHeader(props: { workspaceId: string }) {
  const workspace = useWorkspaceStore((store) =>
    store.workspaces.find((item) => item.workspaceId === props.workspaceId),
  );
  if (workspace === undefined) return null;
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{workspace.title ?? workspace.branch}</h1>
      <p className={styles.meta}>
        <FormattedMessage
          id="workspace.meta"
          values={{ repository: workspace.repositoryName, branch: workspace.branch }}
        />
      </p>
    </header>
  );
}
