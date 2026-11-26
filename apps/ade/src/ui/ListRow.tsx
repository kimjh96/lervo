import type { MouseEvent, ReactNode } from "react";

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
  /** Set on a row that shows or hides a list below it, such as the project switcher. */
  expanded?: boolean;
  /** The row's accessible name when the label alone does not say what it does. */
  accessibleName?: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onDoubleClick?: () => void;
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className={styles.row}
      data-quiet={props.quiet === true ? "true" : undefined}
      aria-current={props.current ? "page" : undefined}
      aria-expanded={props.expanded}
      aria-label={props.accessibleName}
      onClick={props.onClick}
      onDoubleClick={props.onDoubleClick}
      onContextMenu={props.onContextMenu}
    >
      {props.leading}
      <span className={styles.label}>{props.label}</span>
      {props.trailing}
    </button>
  );
}
