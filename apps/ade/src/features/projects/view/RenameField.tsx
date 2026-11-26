import { type ReactNode, useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";

import { RowLeading } from "../../../ui/ListRow";
import type { Repository } from "../../workspaces";
import { renameProject } from "../model/changes";
import type { ProjectDependencies } from "../model/controller";
import { projectName } from "../model/decisions";
import { useProjectStore } from "../model/store";
import styles from "./ProjectSwitcher.module.css";

/**
 * A project's name edited in place (loaded on the first edit, with the change it makes), in its row: Return or leaving the field keeps the new name,
 * Escape keeps the old one. An unchanged or empty name changes nothing.
 */
export function RenameField(props: {
  project: Repository;
  leading: ReactNode;
  dependencies: ProjectDependencies;
}) {
  const intl = useIntl();
  const original = projectName(props.project);
  const [value, setValue] = useState(original);
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (keep: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const name = value.trim();
    if (keep && name.length > 0 && name !== original)
      void renameProject(props.dependencies, props.project.projectId, name);
    else useProjectStore.setState({ renaming: null });
  };
  return (
    <div className={styles.renaming}>
      <RowLeading>{props.leading}</RowLeading>
      <input
        ref={input}
        className={styles.input}
        aria-label={intl.formatMessage({ id: "projects.rename.label" })}
        value={value}
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") finish(true);
          else if (event.key === "Escape") finish(false);
        }}
      />
    </div>
  );
}
