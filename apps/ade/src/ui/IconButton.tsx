import type { ReactNode } from "react";

import styles from "./IconButton.module.css";

/**
 * A button that shows only an icon, such as send. The primary variant is the one action of an
 * input card. Its accessible name is `label`, so it never needs visible text.
 */
export function IconButton(props: {
  label: string;
  icon: ReactNode;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  /** Placement within its parent, such as pushing it to the end of a bar. */
  className?: string | undefined;
}) {
  return (
    <button
      type={props.type ?? "button"}
      className={[styles.button, props.className].filter(Boolean).join(" ")}
      disabled={props.disabled}
      aria-label={props.label}
      onClick={props.onClick}
    >
      {props.icon}
    </button>
  );
}
