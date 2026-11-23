import { type ReactNode, useState } from "react";

import styles from "./PaneHeader.module.css";

/**
 * The header bar of the main area (approved mockup "2a"): a title, a detail in the mono face, and
 * trailing controls. It also moves the window. It arrives with its view unless it replaces a
 * header that looked the same; that is decided when it mounts, so a later change of `arrive`
 * never replays the arrival over a header the user already sees.
 */
export function PaneHeader(props: {
  title: string;
  detail: string;
  arrive: boolean;
  children?: ReactNode;
}) {
  const [arrive] = useState(props.arrive);
  return (
    <header
      className={styles.header}
      data-arrive={arrive ? "true" : undefined}
      data-tauri-drag-region
    >
      <h1 className={styles.title} data-tauri-drag-region>
        {props.title}
      </h1>
      <span className={styles.detail} data-tauri-drag-region>
        {props.detail}
      </span>
      <span className={styles.spacer} data-tauri-drag-region />
      {props.children}
    </header>
  );
}
