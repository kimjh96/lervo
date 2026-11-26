import type { IntlShape } from "react-intl";

import type { Files, MenuItem, Menus } from "../../../ports";
import type { Repository } from "../../workspaces";
import { chooseMark, clearMark, removeProject } from "../model/changes";
import type { ProjectDependencies } from "../model/controller";
import { useProjectStore } from "../model/store";

/** What the project menu and the add row need. */
export interface ProjectMenuContext {
  readonly intl: IntlShape;
  readonly menus: Menus;
  readonly files: Files;
  readonly dependencies: ProjectDependencies;
  /** Whether the core answers project commands; without them only "Show in Finder" remains. */
  readonly managed: boolean;
}

/**
 * A project's context menu (Lervo ADE projects, "The switcher"): change or remove the logo,
 * rename, show the folder in Finder, and remove the project from Lervo, with the note that its
 * files stay. Loaded with the first right-click, so it stays out of the start screen's bundle.
 */
export function showProjectMenu(context: ProjectMenuContext, project: Repository): void {
  const { intl, dependencies, managed } = context;
  const { projectId, root } = project;
  const items: (MenuItem | "separator")[] = [];
  if (managed) {
    items.push({
      text: intl.formatMessage({ id: "projects.menu.logo" }),
      run: () =>
        void chooseMark(dependencies, projectId, intl.formatMessage({ id: "projects.logo.title" })),
    });
    if (project.mark)
      items.push({
        text: intl.formatMessage({ id: "projects.menu.logo.clear" }),
        run: () => void clearMark(dependencies, projectId),
      });
    items.push({
      text: intl.formatMessage({ id: "projects.menu.rename" }),
      run: () => useProjectStore.setState({ renaming: projectId, expanded: false }),
    });
  }
  if (root !== undefined) {
    if (items.length > 0) items.push("separator");
    items.push({
      text: intl.formatMessage({ id: "projects.menu.reveal" }),
      run: () => context.files.reveal(root),
    });
  }
  if (managed)
    items.push(
      "separator",
      {
        text: intl.formatMessage({ id: "projects.menu.remove" }),
        run: () => void removeProject(dependencies, projectId),
      },
      { text: intl.formatMessage({ id: "projects.menu.remove.note" }) },
    );
  if (items.length > 0) void context.menus.show(items);
}
