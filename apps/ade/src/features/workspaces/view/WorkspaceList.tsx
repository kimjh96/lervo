import { FormattedMessage, useIntl } from "react-intl";

import { commandModifier } from "../../../platform/keyboard";
import { transition } from "../../../platform/transition";
import { PlusIcon } from "../../../ui/icons";
import { StatusDot } from "../../../ui/StatusDot";
import { groupByRepository, visibleStatus } from "../model/decisions";
import { useWorkspaceStore } from "../model/store";
import { statusMessages } from "./messages";
import styles from "./WorkspaceList.module.css";

/**
 * "New work" and the workspaces, grouped by repository, with each workspace's live status. A row
 * that arrived after the first load enters with the arrival motion once, when it mounts; loaded
 * rows stay still.
 */
export function WorkspaceList() {
  const intl = useIntl();
  const workspaces = useWorkspaceStore((store) => store.workspaces);
  const arrived = useWorkspaceStore((store) => store.arrived);
  const listFailure = useWorkspaceStore((store) => store.listFailure);
  const statuses = useWorkspaceStore((store) => store.statuses);
  const selected = useWorkspaceStore((store) => store.selected);
  const select = useWorkspaceStore((store) => store.select);
  const newWork = useWorkspaceStore((store) => store.newWork);
  const groups = groupByRepository(workspaces);

  return (
    <section className={styles.list} aria-label={intl.formatMessage({ id: "workspaces.label" })}>
      <button
        type="button"
        className={styles.row}
        aria-current={selected === null ? "page" : undefined}
        onClick={() => transition(newWork)}
      >
        <PlusIcon size="md" />
        <span className={styles.name}>
          <FormattedMessage id="workspaces.new" />
        </span>
        <kbd className={styles.shortcut}>
          <FormattedMessage
            id="keyboard.command"
            values={{
              modifier: commandModifier,
              key: intl.formatMessage({ id: "workspaces.new.key" }),
            }}
          />
        </kbd>
      </button>
      {listFailure === null ? null : (
        <p className={styles.failure} role="alert">
          <FormattedMessage id="workspaces.unavailable" values={{ code: listFailure }} />
        </p>
      )}
      {groups.map((group) => (
        <div key={group.repositoryName}>
          <h3 className={styles.repository}>{group.repositoryName}</h3>
          <ul className={styles.rows}>
            {group.workspaces.map((workspace) => {
              const status = visibleStatus(statuses[workspace.sessionId]);
              const current = selected === workspace.workspaceId;
              return (
                <li
                  key={workspace.workspaceId}
                  data-arrived={arrived.has(workspace.workspaceId) ? "true" : undefined}
                >
                  <button
                    type="button"
                    className={styles.row}
                    data-quiet={status === null && !current ? "true" : undefined}
                    aria-current={current ? "page" : undefined}
                    onClick={() => select(workspace.workspaceId)}
                  >
                    <span className={styles.name}>{workspace.title ?? workspace.branch}</span>
                    {status === null ? null : (
                      <StatusDot
                        tone={status === "working" ? "working" : "attention"}
                        label={intl.formatMessage(statusMessages[status])}
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
