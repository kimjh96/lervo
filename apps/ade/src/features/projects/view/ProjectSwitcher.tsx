import { useEffect, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { isCommandKey } from "../../../platform/keyboard";
import { useFiles, useMenus } from "../../../ports";
import { ChevronDownIcon } from "../../../ui/icons";
import { InlineAlert } from "../../../ui/InlineAlert";
import { ListRow } from "../../../ui/ListRow";
import { Presence } from "../../../ui/Presence";
import { StatusDot } from "../../../ui/StatusDot";
import { useWorkspaceStore } from "../../workspaces";
import { selectProject } from "../model/controller";
import {
  managesProjects,
  projectName,
  projectsNeedingYou,
  shortcutProject,
} from "../model/decisions";
import { useCurrentProject, useProjectDependencies } from "../model/hooks";
import { useProjectStore } from "../model/store";
import type { ProjectMenuContext } from "./project-menu";
import type * as Surface from "./surface";
import { useAddProject } from "./add-project";
import { ProjectMark } from "./ProjectMark";
import styles from "./ProjectSwitcher.module.css";

// The list, the menu, and the name field load when the row is first pointed at or focused, so the
// start screen's bundle carries only the row (ADE performance, bundle budget). The list shows only
// once its module is loaded, so its space opens to its full size (ADE motion, "Space").
const load = () => import("./surface");

/**
 * The sidebar's first row (Lervo ADE projects, "The switcher"): the selected project's mark and
 * name, with a dot when another project's workspaces need the owner. It shows the list of
 * projects below it. A double-click edits the name in place; the context menu changes the logo,
 * renames, shows the folder in Finder, or removes the project from Lervo. `⌘1`–`⌘9` select a
 * project. With no project, nothing shows here.
 */
export function ProjectSwitcher() {
  const intl = useIntl();
  const dependencies = useProjectDependencies();
  const menus = useMenus();
  const files = useFiles();
  const workspaces = useWorkspaceStore((store) => store.workspaces);
  const statuses = useWorkspaceStore((store) => store.statuses);
  const advertised = useWorkspaceStore((store) => store.advertisedCommands);
  const expanded = useProjectStore((store) => store.expanded);
  const renaming = useProjectStore((store) => store.renaming);
  const failure = useProjectStore((store) => store.failure);

  const current = useCurrentProject();
  const { memory } = dependencies;
  const [surface, setSurface] = useState<typeof Surface | null>(null);
  const ensure = () =>
    load().then((module) => {
      setSurface(module);
      return module;
    });
  const preload = () => void ensure();
  const context: ProjectMenuContext = {
    intl,
    menus,
    files,
    dependencies,
    managed: managesProjects(advertised),
  };

  // ⌘1 to ⌘9 select the projects in list order, as the list shows.
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const project = shortcutProject(useWorkspaceStore.getState().repositories, event.key);
      if (project === undefined || !isCommandKey(event, event.key)) return;
      event.preventDefault();
      selectProject(memory, project.projectId);
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [memory]);

  // ⌘O opens a folder as a project, as "Open Folder" in the Add Project menu shows.
  const add = useAddProject();
  const openFolder = useRef(add.openFolder);
  useEffect(() => {
    openFolder.current = add.openFolder;
  });
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!isCommandKey(event, "o")) return;
      if (!managesProjects(useWorkspaceStore.getState().advertisedCommands)) return;
      event.preventDefault();
      openFolder.current();
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  if (current === null) return null;
  const elsewhere = [...projectsNeedingYou(workspaces, statuses)].some(
    (projectId) => projectId !== current.projectId,
  );

  return (
    <section
      className={styles.switcher}
      aria-label={intl.formatMessage({ id: "projects.label" })}
      onPointerEnter={preload}
      onFocus={preload}
    >
      {renaming === current.projectId && surface !== null ? (
        <surface.RenameField
          project={current}
          leading={<ProjectMark project={current} size="md" />}
          dependencies={dependencies}
        />
      ) : (
        <ListRow
          current={false}
          expanded={expanded}
          accessibleName={intl.formatMessage(
            { id: "projects.current" },
            { name: projectName(current) },
          )}
          // The second click of a double-click edits the name instead of closing the list.
          onClick={(event) => {
            if (event.detail > 1) return;
            void ensure().then(() => useProjectStore.setState({ expanded: !expanded }));
          }}
          onDoubleClick={() => {
            if (context.managed)
              void ensure().then(() =>
                useProjectStore.setState({ renaming: current.projectId, expanded: false }),
              );
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            void ensure().then((module) => module.showProjectMenu(context, current));
          }}
          leading={<ProjectMark project={current} size="md" />}
          label={<span className={styles.name}>{projectName(current)}</span>}
          trailing={
            <span className={styles.trailing}>
              <Presence as="span">
                {elsewhere ? (
                  <StatusDot label={intl.formatMessage({ id: "projects.needsYou" })} />
                ) : null}
              </Presence>
              <span className={styles.chevron} data-expanded={expanded ? "true" : undefined}>
                <ChevronDownIcon size="sm" />
              </span>
            </span>
          }
        />
      )}
      <Presence>
        {expanded && surface !== null ? (
          <surface.ProjectList context={context} current={current} />
        ) : null}
      </Presence>
      <Presence className={styles.failure}>
        {failure === null ? null : (
          <InlineAlert size="caption">
            <FormattedMessage id="projects.failed" values={{ code: failure }} />
          </InlineAlert>
        )}
      </Presence>
    </section>
  );
}
