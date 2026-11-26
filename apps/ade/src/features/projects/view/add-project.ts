import { useIntl } from "react-intl";

import { commandModifier } from "../../../platform/keyboard";
import { addFolder } from "../model/add";
import { openProjectSheet } from "../model/controller";
import { useAddDependencies } from "../model/hooks";

/**
 * The three ways to add a project (Lervo ADE projects, "Adding a project"): open a folder, which
 * goes straight to the system folder panel, clone a repository, or start a new project, which
 * open their window. `items` offers all three as a menu, as "Add Project" does.
 */
export function useAddProject() {
  const intl = useIntl();
  const dependencies = useAddDependencies();
  const openFolder = () =>
    void dependencies.choosers
      .folder(intl.formatMessage({ id: "projects.add.title" }))
      .then((path) => {
        if (path !== null) void addFolder(dependencies, path);
      });
  const cloneRepository = () => openProjectSheet("clone");
  const newProject = () => openProjectSheet("new");
  return {
    openFolder,
    cloneRepository,
    newProject,
    /** Adds a folder dropped on the window as a project. */
    addDropped: (path: string) => void addFolder(dependencies, path),
    /** The three ways as menu items, as "Add Project" offers them. */
    items: [
      {
        text: intl.formatMessage({ id: "projects.menu.openFolder" }),
        shortcut: intl.formatMessage(
          { id: "keyboard.command" },
          { modifier: commandModifier, key: "O" },
        ),
        run: openFolder,
      },
      { text: intl.formatMessage({ id: "projects.menu.clone" }), run: cloneRepository },
      { text: intl.formatMessage({ id: "projects.menu.new" }), run: newProject },
    ],
  };
}
