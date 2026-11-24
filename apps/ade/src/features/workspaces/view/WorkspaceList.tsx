import { FormattedMessage, useIntl } from "react-intl";

import { commandModifier } from "../../../platform/keyboard";
import { PlusIcon } from "../../../ui/icons";
import { InlineAlert } from "../../../ui/InlineAlert";
import { Kbd } from "../../../ui/Kbd";
import { ListRow } from "../../../ui/ListRow";
import { StatusDot } from "../../../ui/StatusDot";
import { Presence } from "../../../ui/Presence";
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
      <ListRow
        current={selected === null}
        onClick={newWork}
        leading={<PlusIcon size="md" />}
        label={<FormattedMessage id="workspaces.new" />}
        trailing={
          <Kbd>
            {intl.formatMessage(
              { id: "keyboard.command" },
              { modifier: commandModifier, key: intl.formatMessage({ id: "workspaces.new.key" }) },
            )}
          </Kbd>
        }
      />
      <Presence className={styles.failure}>
        {listFailure === null ? null : (
          <InlineAlert size="caption">
            <FormattedMessage id="workspaces.unavailable" values={{ code: listFailure }} />
          </InlineAlert>
        )}
      </Presence>
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
                  <ListRow
                    current={current}
                    quiet={status === null && !current}
                    onClick={() => select(workspace.workspaceId)}
                    label={workspace.title ?? workspace.branch}
                    trailing={
                      <Presence as="span">
                        {status === null ? null : (
                          <StatusDot
                            tone={status === "working" ? "working" : "attention"}
                            label={intl.formatMessage(statusMessages[status])}
                          />
                        )}
                      </Presence>
                    }
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
