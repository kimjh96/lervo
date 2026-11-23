import type { ReactNode } from "react";

import styles from "./FloatingButton.module.css";

/**
 * A small pill-shaped button that floats over content on glass, such as "Jump to latest". It
 * fades in when it appears; its parent places it.
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
      {props.children}
    </button>
  );
}
