import type { ReactNode } from "react";

import styles from "./PaneHeader.module.css";
import { Presence } from "./Presence";

/**
 * The header bar of the main area (approved mockup "2a"): a title, a detail in the mono face, and
 * trailing controls. It also moves the window. It arrives and leaves with its view; a detail that
 * comes or goes while it shows fades in place.
 */
export function PaneHeader(props: {
  title: string;
  /** A short fact beside the title in the mono face, such as the repository of work starting. */
  detail?: string | undefined;
  children?: ReactNode;
}) {
  return (
    <header className={styles.header} data-tauri-drag-region>
      <h1 className={styles.title} data-tauri-drag-region>
        {props.title}
      </h1>
      <Presence as="span">
        {props.detail === undefined ? null : (
          <span className={styles.detail} data-tauri-drag-region>
            {props.detail}
          </span>
        )}
      </Presence>
      <span className={styles.spacer} data-tauri-drag-region />
      {props.children}
    </header>
  );
}
