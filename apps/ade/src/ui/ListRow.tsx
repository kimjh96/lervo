import type { ReactNode } from "react";

import styles from "./ListRow.module.css";

/**
 * A row of a navigation list, such as the workspace list: a label that truncates, with an
 * optional icon before it and a status or shortcut after it. The current row is raised; a quiet
 * row reads in the secondary color.
 */
export function ListRow(props: {
  label: ReactNode;
  current: boolean;
  quiet?: boolean | undefined;
  leading?: ReactNode;
  trailing?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.row}
      data-quiet={props.quiet === true ? "true" : undefined}
      aria-current={props.current ? "page" : undefined}
      onClick={props.onClick}
    >
      {props.leading}
      <span className={styles.label}>{props.label}</span>
      {props.trailing}
    </button>
  );
}
