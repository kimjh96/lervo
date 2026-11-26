import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { commandModifier } from "../../../platform/keyboard";
import { PlusIcon } from "../../../ui/icons";
import { Kbd } from "../../../ui/Kbd";
import { ListRow } from "../../../ui/ListRow";
import { PopoverMenu } from "../../../ui/PopoverMenu";
import { Presence } from "../../../ui/Presence";
import { StatusDot } from "../../../ui/StatusDot";
import { type Repository, useWorkspaceStore } from "../../workspaces";
import { selectProject } from "../model/controller";
import { projectName, projectsNeedingYou } from "../model/decisions";
import { useProjectStore } from "../model/store";
import { type ProjectMenuContext, showProjectMenu } from "./project-menu";
import { useAddProject } from "./add-project";
import { ProjectMark } from "./ProjectMark";
import { RenameField } from "./RenameField";
import styles from "./ProjectSwitcher.module.css";

/**
 * The list the switcher shows below its row: every project with its mark, a dot when its
 * workspaces need the owner, and its `⌘1`–`⌘9` key, then "Add project". Loaded when the list
 * first opens, so it stays out of the start screen's bundle.
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
  const rename = (project: Repository) => {
    if (context.managed) useProjectStore.setState({ renaming: project.projectId });
  };
  return (
    <div className={styles.list}>
      <ul className={styles.projects}>
        {repositories.map((project, index) => (
          <li key={project.projectId}>
            {renaming === project.projectId ? (
              <RenameField
                project={project}
                leading={<ProjectMark project={project} size="sm" />}
                dependencies={context.dependencies}
              />
            ) : (
              <ListRow
                current={project.projectId === props.current.projectId}
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
                          tone="attention"
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
          </li>
        ))}
      </ul>
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
