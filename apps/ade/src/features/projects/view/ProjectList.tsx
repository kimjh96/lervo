import { type ReactNode, useMemo, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { commandModifier } from "../../../platform/keyboard";
import { PlusIcon } from "../../../ui/icons";
import { Kbd } from "../../../ui/Kbd";
import { useDepartingInPlace } from "../../../ui/departing";
import { ListRow } from "../../../ui/ListRow";
import { PopoverMenu } from "../../../ui/PopoverMenu";
import { Presence } from "../../../ui/Presence";
import { useItemSpace } from "../../../ui/space";
import { StatusDot } from "../../../ui/StatusDot";
import { type Repository, useWorkspaceStore } from "../../workspaces";
import { selectProject } from "../model/controller";
import { otherProjects, projectName, projectsNeedingYou } from "../model/decisions";
import { useProjectStore } from "../model/store";
import { type ProjectMenuContext, showProjectMenu } from "./project-menu";
import { useAddProject } from "./add-project";
import { ProjectMark } from "./ProjectMark";
import { RenameField } from "./RenameField";
import styles from "./ProjectSwitcher.module.css";

/**
 * The list the switcher shows below its row: every other project with its mark, a dot when its
 * workspaces need the owner, and its `⌘1`–`⌘9` key, then "Add project". The selected project
 * shows only in the row above, so it never reads twice. Keys follow the order of every project,
 * as they do with the list closed. Loaded when the list first opens, so it stays out of the start
 * screen's bundle.
 */
export function ProjectList(props: { context: ProjectMenuContext; current: Repository }) {
  const intl = useIntl();
  const { context } = props;
  const repositories = useWorkspaceStore((store) => store.repositories);
  const workspaces = useWorkspaceStore((store) => store.workspaces);
  const statuses = useWorkspaceStore((store) => store.statuses);
  const renaming = useProjectStore((store) => store.renaming);
  const add = useAddProject();
  const [menuAt, setMenuAt] = useState<{ rect: DOMRect; byKey: boolean } | null>(null);
  const needing = projectsNeedingYou(workspaces, statuses);
  const currentId = props.current.projectId;
  const others = useMemo(() => otherProjects(repositories, currentId), [repositories, currentId]);
  // A project removed while the list is open fades out where it was and closes its space; one
  // added opens its space as it fades in (ADE motion, "Coming and going" and "Space").
  const shown = useDepartingInPlace(others, entryKey);
  const [initial] = useState(() => new Set(others.map(entryKey)));
  const rename = (project: Repository) => {
    if (context.managed) useProjectStore.setState({ renaming: project.projectId });
  };
  return (
    <div className={styles.list}>
      <Presence>
        {shown.length === 0 ? null : (
          <ul className={styles.projects}>
            {shown.map(({ item: { project, index }, leaving }) => (
              <ProjectRow
                key={project.projectId}
                arrived={!initial.has(project.projectId)}
                leaving={leaving}
              >
                {/* motion: Renaming in place */}
                {renaming === project.projectId ? (
                  <RenameField
                    project={project}
                    leading={<ProjectMark project={project} size="sm" />}
                    dependencies={context.dependencies}
                  />
                ) : (
                  <ListRow
                    current={false}
                    // The second click of a double-click edits the name instead.
                    onClick={(event) => {
                      if (event.detail <= 1)
                        selectProject(context.dependencies.memory, project.projectId);
                    }}
                    onDoubleClick={() => rename(project)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      showProjectMenu(context, project);
                    }}
                    leading={<ProjectMark project={project} size="sm" />}
                    label={projectName(project)}
                    trailing={
                      <span className={styles.trailing}>
                        <Presence as="span">
                          {needing.has(project.projectId) ? (
                            <StatusDot
                              label={intl.formatMessage({ id: "workspaces.status.needsYou" })}
                            />
                          ) : null}
                        </Presence>
                        <Presence as="span">
                          {index < 9 ? (
                            <Kbd>
                              {intl.formatMessage(
                                { id: "keyboard.command" },
                                { modifier: commandModifier, key: String(index + 1) },
                              )}
                            </Kbd>
                          ) : null}
                        </Presence>
                      </span>
                    }
                  />
                )}
              </ProjectRow>
            ))}
          </ul>
        )}
      </Presence>
      <Presence>
        {context.managed ? (
          <ListRow
            current={false}
            quiet
            // A click a key made has no pointer detail.
            onClick={(event) =>
              setMenuAt({
                rect: event.currentTarget.getBoundingClientRect(),
                byKey: event.detail === 0,
              })
            }
            leading={<PlusIcon size="md" />}
            label={<FormattedMessage id="projects.add" />}
          />
        ) : null}
      </Presence>
      {/* motion: Overlays: command palette, menus, popovers */}
      {menuAt === null ? null : (
        <PopoverMenu
          anchor={menuAt.rect}
          openedByKey={menuAt.byKey}
          label={intl.formatMessage({ id: "projects.add" })}
          items={add.items}
          onClose={() => setMenuAt(null)}
        />
      )}
    </div>
  );
}

const entryKey = (entry: { project: Repository }) => entry.project.projectId;

/** A project's row in the open list, which opens and closes its space as it comes and goes. */
function ProjectRow(props: { arrived: boolean; leaving: boolean; children: ReactNode }) {
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
