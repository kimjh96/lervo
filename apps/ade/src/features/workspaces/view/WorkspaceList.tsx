import { FormattedMessage, useIntl } from "react-intl";

import { StatusDot } from "../../../ui/StatusDot";
import { groupByRepository, visibleStatus } from "../model/decisions";
import { useWorkspaceStore } from "../model/store";
import styles from "./WorkspaceList.module.css";

/** The workspace list, grouped by repository, with each workspace's live status. */
export function WorkspaceList() {
  const intl = useIntl();
  const workspaces = useWorkspaceStore((store) => store.workspaces);
  const statuses = useWorkspaceStore((store) => store.statuses);
  const selected = useWorkspaceStore((store) => store.selected);
  const select = useWorkspaceStore((store) => store.select);
  const groups = groupByRepository(workspaces);
  return (
    <section className={styles.list} aria-labelledby="workspaces-title">
      <div className={styles.heading}>
        <h2 id="workspaces-title" className={styles.title}>
          <FormattedMessage id="workspaces.title" />
        </h2>
        <button type="button" className={styles.new} onClick={() => select(null)}>
          <FormattedMessage id="workspaces.new" />
        </button>
      </div>
      {groups.length === 0 ? (
        <p className={styles.empty}>
          <FormattedMessage id="workspaces.empty" />
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.repositoryName} className={styles.group}>
            <h3 className={styles.repository}>{group.repositoryName}</h3>
            <ul className={styles.rows}>
              {group.workspaces.map((workspace) => {
                const status = visibleStatus(statuses[workspace.sessionId]);
                return (
                  <li key={workspace.workspaceId}>
                    <button
                      type="button"
                      className={styles.row}
                      aria-current={selected === workspace.workspaceId ? "true" : undefined}
                      onClick={() => select(workspace.workspaceId)}
                    >
                      <span className={styles.name}>{workspace.title ?? workspace.branch}</span>
                      {status === null ? null : (
                        <StatusDot
                          tone={status === "working" ? "working" : "attention"}
                          label={intl.formatMessage({ id: `workspaces.status.${status}` })}
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
