import type { ReactNode } from "react";

import styles from "./PaneHeader.module.css";

/**
 * The header bar of the main area (approved mockup "2a"): a title, which may be a control such as
 * a title renamed in place, and trailing controls. It also moves the window. It arrives and leaves
 * with its view.
 */
export function PaneHeader(props: { title: ReactNode; children?: ReactNode }) {
  return (
    <header className={styles.header} data-tauri-drag-region>
      <h1 className={styles.title} data-tauri-drag-region>
        {props.title}
      </h1>
      <span className={styles.spacer} data-tauri-drag-region />
      {props.children}
    </header>
  );
}
