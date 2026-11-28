import { conversationOrder } from "@lervo/session-host-contract";
import { type ReactNode, useMemo } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { commandModifier } from "../../../platform/keyboard";
import { PlusIcon } from "../../../ui/icons";
import { InlineAlert } from "../../../ui/InlineAlert";
import { Kbd } from "../../../ui/Kbd";
import { ListRow } from "../../../ui/ListRow";
import { type ShownItem, useDepartingInPlace } from "../../../ui/departing";
import { useMoved } from "../../../ui/moving";
import { useItemSpace } from "../../../ui/space";
import { StatusDot } from "../../../ui/StatusDot";
import { WorkingLabel } from "../../../ui/WorkingLabel";
import { Presence } from "../../../ui/Presence";
import { SectionHeading } from "../../../ui/SectionHeading";
import { useApplicationCommands, useListCache, useMenus } from "../../../ports";
import { changesConversations, renameConversation } from "../model/changes";
import { groupByRepository, workspaceStatus } from "../model/decisions";
import { useWorkspaceStore } from "../model/store";
import type { Workspace } from "../model/types";
import { showConversationMenu } from "./conversation-menu";
import { statusMessages } from "./messages";
import { TitleField } from "./TitleField";
import styles from "./WorkspaceList.module.css";

/**
 * A row's key for its place: a pinned conversation's row is another row than its unpinned one, so
 * pinning leaves its place and arrives at the top, and unpinning the other way (ADE motion,
 * "Moving a row").
 */
const placeKey = (workspace: Workspace) =>
  `${workspace.pinnedAt === undefined ? "listed" : "pinned"}:${workspace.workspaceId}`;
const workspaceKey = (workspace: Workspace) => workspace.workspaceId;

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

/** A conversation's row, or its title's field while the person renames it in place. */
function WorkspaceRow(props: { workspace: Workspace }) {
  const intl = useIntl();
  const commands = useApplicationCommands();
  const lists = useListCache();
  const menus = useMenus();
  const { workspace } = props;
  const status = useWorkspaceStore((store) => workspaceStatus(workspace, store.statuses));
  const current = useWorkspaceStore((store) => store.selected === workspace.workspaceId);
  const renaming = useWorkspaceStore((store) => store.renaming === workspace.workspaceId);
  const advertised = useWorkspaceStore((store) => store.advertisedCommands);
  const select = useWorkspaceStore((store) => store.select);
  const title = workspace.title ?? workspace.branch;
  const changes = changesConversations(advertised);
  // motion: Renaming in place
  if (renaming)
    return (
      <div className={styles.renaming}>
        <TitleField
          title={title}
          label={intl.formatMessage({ id: "workspaces.rename.label" })}
          className={styles.input}
          onDone={(renamed) => {
            useWorkspaceStore.setState({ renaming: null });
            if (renamed !== null)
              void renameConversation({ commands, lists }, workspace.workspaceId, renamed);
          }}
        />
      </div>
    );
  return (
    <ListRow
      current={current}
      onClick={() => select(workspace.workspaceId)}
      onContextMenu={(event) => {
        if (!changes.renames && !changes.pins) return;
        event.preventDefault();
        showConversationMenu({ intl, menus, commands, lists, changes }, workspace);
      }}
      label={
        <WorkingLabel
          title={title}
          working={status === "working" ? intl.formatMessage(statusMessages.working) : null}
        />
      }
      trailing={
        <Presence as="span">
          {status === "needsYou" ? (
            <StatusDot label={intl.formatMessage(statusMessages.needsYou)} />
          ) : null}
        </Presence>
      }
    />
  );
}

function WorkspaceRows(props: {
  rows: readonly ShownItem<Workspace>[];
  moved: ReadonlySet<string>;
}) {
  const arrived = useWorkspaceStore((store) => store.arrived);
  return (
    <ul className={styles.rows}>
      {props.rows.map(({ item: workspace, leaving }) => (
        <Row
          key={placeKey(workspace)}
          arrived={arrived.has(workspace.workspaceId) || props.moved.has(placeKey(workspace))}
          leaving={leaving}
        >
          <WorkspaceRow workspace={workspace} />
        </Row>
      ))}
    </ul>
  );
}

/** "New work", the one row that starts a conversation, once the lists hold a project. */
function NewWork() {
  const intl = useIntl();
  const selected = useWorkspaceStore((store) => store.selected);
  const newWork = useWorkspaceStore((store) => store.newWork);
  // Work starts in a project, so "New work" shows once the lists are known to hold one; with none,
  // the start screen offers adding the first (ADE craft rules, 13).
  const hasProject = useWorkspaceStore(
    (store) => (store.loaded || store.cached) && store.repositories.length > 0,
  );
  return (
    <Presence>
      {hasProject ? (
        <ListRow
          current={selected === null}
          onClick={newWork}
          leading={<PlusIcon size="md" />}
          label={<FormattedMessage id="workspaces.new" />}
          trailing={
            <Kbd>
              {intl.formatMessage(
                { id: "keyboard.command" },
                {
                  modifier: commandModifier,
                  key: intl.formatMessage({ id: "workspaces.new.key" }),
                },
              )}
            </Kbd>
          }
        />
      ) : null}
    </Presence>
  );
}

/** A failed reload, or a refused rename or pin, as one line. */
function Failures() {
  const listFailure = useWorkspaceStore((store) => store.listFailure);
  const changeFailure = useWorkspaceStore((store) => store.changeFailure);
  return (
    <>
      <Presence className={styles.failure}>
        {listFailure === null ? null : (
          <InlineAlert size="caption">
            <FormattedMessage id="workspaces.unavailable" values={{ code: listFailure }} />
          </InlineAlert>
        )}
      </Presence>
      <Presence className={styles.failure}>
        {changeFailure === null ? null : (
          <InlineAlert size="caption">
            <FormattedMessage id="workspaces.changeFailed" values={{ code: changeFailure }} />
          </InlineAlert>
        )}
      </Presence>
    </>
  );
}

/**
 * "New work" and the workspaces, with each workspace's live status, the pinned ones first. With a
 * project selected in the switcher, only its workspaces show, and selecting another project
 * crossfades the rows in place; without one, the workspaces group by repository. A row that
 * arrived after the first load enters with the arrival motion once, when it mounts; loaded rows
 * stay still. A removed row fades out where it was, and a pinned or unpinned one moves to its new
 * place. A repository's name arrives with its first row and leaves with its last.
 */
export function WorkspaceList(props: {
  projectId: string | null;
  /** What sits between "New work" and the conversations, such as the project's agents. */
  beforeRows?: ReactNode;
  /** Whether a "Conversations" heading names the rows, as it does below the agents; it shows only
   * over rows. */
  conversationsHeading?: boolean;
}) {
  const intl = useIntl();
  const workspaces = useWorkspaceStore((store) => store.workspaces);
  const arrived = useWorkspaceStore((store) => store.arrived);
  const ordered = useMemo(() => conversationOrder(workspaces), [workspaces]);
  // Departures and moves are tracked over every workspace, so switching projects never reads as
  // removal.
  const all = useDepartingInPlace(ordered, placeKey);
  const moved = useMoved(ordered, placeKey, workspaceKey);
  const { projectId } = props;
  const shown = all.filter(({ item }) => projectId === null || item.projectId === projectId);

  return (
    <section className={styles.list} aria-label={intl.formatMessage({ id: "workspaces.label" })}>
      <NewWork />
      <Failures />
      {props.beforeRows}
      <Presence>
        {props.conversationsHeading === true && projectId !== null && shown.length > 0 ? (
          <SectionHeading label={intl.formatMessage({ id: "workspaces.conversations" })} />
        ) : null}
      </Presence>
      {projectId !== null ? (
        <Presence contentKey={projectId} className={styles.project}>
          <WorkspaceRows rows={shown} moved={moved} />
        </Presence>
      ) : (
        groupByRepository(shown, (row) => row.item.repositoryName).map((group) => (
          <div key={group.repositoryName}>
            <Heading
              arrived={group.items.every(({ item }) => arrived.has(item.workspaceId))}
              leaving={group.items.every((row) => row.leaving)}
            >
              {group.repositoryName}
            </Heading>
            <WorkspaceRows rows={group.items} moved={moved} />
          </div>
        ))
      )}
    </section>
  );
}
