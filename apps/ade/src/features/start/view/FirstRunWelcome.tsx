import { FormattedMessage, useIntl } from "react-intl";

import { useFiles } from "../../../ports";
import { CloneIcon, FolderIcon, PlusIcon } from "../../../ui/icons";
import { InlineAlert } from "../../../ui/InlineAlert";
import { Presence } from "../../../ui/Presence";
import { Waiting } from "../../../ui/Waiting";
import { useFileDrop } from "../../conversation";
import { useAddProject, useAddStore } from "../../projects";
import styles from "./FirstRunWelcome.module.css";

/**
 * The start screen with no project yet (Lervo ADE projects, "The first run"): adding a project is
 * the only thing to start, so it offers the three ways as cards, Open Folder, Clone Repository,
 * and New Project, and takes a folder dropped on the window. After the first project the start
 * screen is the usual one.
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
      icon: <FolderIcon size="lg" />,
      title: intl.formatMessage({ id: "start.firstRun.folder.title" }),
      detail: intl.formatMessage({ id: "start.firstRun.folder.detail" }),
      run: add.openFolder,
    },
    {
      key: "clone",
      icon: <CloneIcon size="lg" />,
      title: intl.formatMessage({ id: "start.firstRun.clone.title" }),
      detail: intl.formatMessage({ id: "start.firstRun.clone.detail" }),
      run: add.cloneRepository,
    },
    {
      key: "new",
      icon: <PlusIcon size="lg" />,
      title: intl.formatMessage({ id: "start.firstRun.new.title" }),
      detail: intl.formatMessage({ id: "start.firstRun.new.detail" }),
      run: add.newProject,
    },
  ];
  return (
    <div className={styles.welcome} data-dropping={dragging ? "" : undefined}>
      <h1 className={styles.title}>
        <FormattedMessage id="start.firstRun.title" />
      </h1>
      <p className={styles.subtitle}>
        <FormattedMessage id="start.firstRun.subtitle" />
      </p>
      <div className={styles.choices}>
        {choices.map((choice) => (
          <button
            key={choice.key}
            type="button"
            className={styles.choice}
            disabled={adding !== null}
            onClick={choice.run}
          >
            <span className={styles.icon}>{choice.icon}</span>
            <span className={styles.choiceTitle}>{choice.title}</span>
            <span className={styles.detail}>{choice.detail}</span>
          </button>
        ))}
      </div>
      <Presence className={styles.below} contentKey={adding === "folder" ? "adding" : "hint"}>
        {adding === "folder" ? (
          <Waiting label={intl.formatMessage({ id: "start.firstRun.adding" })} />
        ) : dragging ? (
          <FormattedMessage id="start.firstRun.drop" />
        ) : (
          <FormattedMessage id="start.firstRun.dropHint" />
        )}
      </Presence>
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
