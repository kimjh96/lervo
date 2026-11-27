import { FormattedMessage, useIntl } from "react-intl";

import { useFiles } from "../../../ports";
import { ChevronRightIcon, CloneIcon, FolderIcon, PlusIcon } from "../../../ui/icons";
import { InlineAlert } from "../../../ui/InlineAlert";
import { LervoMark } from "../../../ui/LervoMark";
import { Presence } from "../../../ui/Presence";
import { Waiting } from "../../../ui/Waiting";
import { useFileDrop } from "../../conversation";
import { useAddProject, useAddStore } from "../../projects";
import styles from "./FirstRunWelcome.module.css";

/**
 * The start screen with no project yet (Lervo ADE projects, "The first run"): the first screen a
 * person sees, so it carries the Lervo mark where the launch view left it, over a welcome. Adding a
 * project is the only thing to start, so it offers the three ways as the rows of one group, Open
 * Folder, Clone Repository, and New Project, as a macOS welcome window does, and takes a folder
 * dropped on the window: the line under the welcome says so, and says when a folder is over it.
 * The sidebar folds away meanwhile, since it has nothing to list. After the first project the
 * start screen is the usual one.
 */
export function FirstRunWelcome() {
  const intl = useIntl();
  const files = useFiles();
  const add = useAddProject();
  const adding = useAddStore((store) => store.adding);
  const failure = useAddStore((store) => store.failure);
  const dragging = useFileDrop((paths) => {
    void files.describe(paths).then((described) => {
      const folder = described.find((file) => file.directory && file.exists);
      if (folder !== undefined) add.addDropped(folder.path);
    });
  });
  const choices = [
    {
      key: "folder",
      icon: <FolderIcon size="md" />,
      title: intl.formatMessage({ id: "start.firstRun.folder.title" }),
      detail: intl.formatMessage({ id: "start.firstRun.folder.detail" }),
      run: add.openFolder,
    },
    {
      key: "clone",
      icon: <CloneIcon size="md" />,
      title: intl.formatMessage({ id: "start.firstRun.clone.title" }),
      detail: intl.formatMessage({ id: "start.firstRun.clone.detail" }),
      run: add.cloneRepository,
    },
    {
      key: "new",
      icon: <PlusIcon size="md" />,
      title: intl.formatMessage({ id: "start.firstRun.new.title" }),
      detail: intl.formatMessage({ id: "start.firstRun.new.detail" }),
      run: add.newProject,
    },
  ];
  return (
    <div className={styles.welcome} data-dropping={dragging ? "" : undefined}>
      <LervoMark size="welcome" />
      <h1 className={styles.title}>
        <FormattedMessage id="start.firstRun.title" />
      </h1>
      {/* The one line under the welcome changes in place: what to do, a folder over the window, or
          the folder being added. */}
      <Presence
        className={styles.subtitle}
        justify="center"
        contentKey={adding === "folder" ? "adding" : dragging ? "drop" : "intro"}
      >
        {adding === "folder" ? (
          <Waiting label={intl.formatMessage({ id: "start.firstRun.adding" })} justify="center" />
        ) : dragging ? (
          <FormattedMessage id="start.firstRun.drop" />
        ) : (
          <FormattedMessage id="start.firstRun.subtitle" />
        )}
      </Presence>
      <div
        className={styles.choices}
        role="group"
        aria-label={intl.formatMessage({ id: "start.firstRun.title" })}
      >
        {choices.map((choice) => (
          <button
            key={choice.key}
            type="button"
            className={styles.choice}
            disabled={adding !== null}
            onClick={choice.run}
          >
            <span className={styles.icon}>{choice.icon}</span>
            <span className={styles.text}>
              <span className={styles.choiceTitle}>{choice.title}</span>
              <span className={styles.detail}>{choice.detail}</span>
            </span>
            <span className={styles.chevron}>
              <ChevronRightIcon size="sm" />
            </span>
          </button>
        ))}
      </div>
      <Presence className={styles.below}>
        {/* motion: Inline errors */}
        {failure === null ? null : (
          <InlineAlert size="note">
            <FormattedMessage id="start.firstRun.failed" values={{ code: failure }} />
          </InlineAlert>
        )}
      </Presence>
    </div>
  );
}
