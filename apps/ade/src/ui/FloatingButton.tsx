import type { ReactNode } from "react";

import styles from "./FloatingButton.module.css";

/**
 * A small pill-shaped button that floats over content on glass, such as "Jump to latest". Its
 * parent places it and brings it with `Presence`'s rise arrival; its words fade in on their own.
 */
export function FloatingButton(props: {
  children: ReactNode;
  onClick: () => void;
  className?: string | undefined;
}) {
  return (
    <button
      type="button"
      className={[styles.pill, props.className].filter(Boolean).join(" ")}
      onClick={props.onClick}
    >
      <span className={styles.label}>{props.children}</span>
    </button>
  );
}
