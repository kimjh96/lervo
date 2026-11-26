import type { ReactNode } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { commandModifier } from "../../../platform/keyboard";
import { PlusIcon } from "../../../ui/icons";
import { InlineAlert } from "../../../ui/InlineAlert";
import { Kbd } from "../../../ui/Kbd";
import { ListRow } from "../../../ui/ListRow";
import { useDeparting } from "../../../ui/departing";
import { useItemSpace } from "../../../ui/space";
import { StatusDot } from "../../../ui/StatusDot";
import { Presence } from "../../../ui/Presence";
import { groupByRepository, visibleStatus } from "../model/decisions";
import { useWorkspaceStore } from "../model/store";
import { statusMessages } from "./messages";
import styles from "./WorkspaceList.module.css";

const workspaceKey = (workspace: { workspaceId: string }) => workspace.workspaceId;

/**
 * A workspace row: one that arrives while the person watches opens its space and enters; one that
 * leaves fades and closes its space where it was (ADE motion, "Coming and going" and "Space").
 */
function Row(props: { arrived: boolean; leaving: boolean; children: ReactNode }) {
  const space = useItemSpace<HTMLLIElement>(props.arrived, props.leaving);
  return (
    <li
      ref={space}
      data-arrived={props.arrived ? "true" : undefined}
      data-leaving={props.leaving ? "" : undefined}
      aria-hidden={props.leaving ? true : undefined}
      inert={props.leaving}
    >
      {props.children}
    </li>
  );
}

/** A repository's name, which arrives with its first row and leaves with its last. */
function Heading(props: { arrived: boolean; leaving: boolean; children: ReactNode }) {
  const space = useItemSpace<HTMLHeadingElement>(props.arrived, props.leaving);
  return (
    <h3
      ref={space}
      className={styles.repository}
      data-arrived={props.arrived ? "true" : undefined}
      data-leaving={props.leaving ? "" : undefined}
    >
      {props.children}
    </h3>
  );
}

/**
 * "New work" and the workspaces, grouped by repository, with each workspace's live status. A row
 * that arrived after the first load enters with the arrival motion once, when it mounts; loaded
 * rows stay still. A removed row fades out where it was. A repository's name arrives with its
 * first row and leaves with its last.
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
  const departed = useDeparting(workspaces, workspaceKey);
  const leaving = new Set(departed.map(workspaceKey));
  const groups = groupByRepository([...workspaces, ...departed]);

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
          <Heading
            arrived={group.workspaces.every((workspace) => arrived.has(workspace.workspaceId))}
            leaving={group.workspaces.every((workspace) => leaving.has(workspace.workspaceId))}
          >
            {group.repositoryName}
          </Heading>
          <ul className={styles.rows}>
            {group.workspaces.map((workspace) => {
              const status = visibleStatus(statuses[workspace.sessionId]);
              const current = selected === workspace.workspaceId;
              const gone = leaving.has(workspace.workspaceId);
              return (
                <Row
                  key={workspace.workspaceId}
                  arrived={arrived.has(workspace.workspaceId)}
                  leaving={gone}
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
                </Row>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
