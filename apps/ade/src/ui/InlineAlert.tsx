import type { ReactNode } from "react";

import styles from "./InlineAlert.module.css";

/**
 * A failure shown where it happened, read out once by screen readers. It fades in over the
 * change duration and never shakes (ADE motion, "Inline errors"). `size` follows the text it
 * sits among.
 */
export function InlineAlert(props: {
  size: "note" | "meta" | "caption";
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <p
      className={[styles.alert, props.className].filter(Boolean).join(" ")}
      data-size={props.size}
      role="alert"
    >
      {props.children}
    </p>
  );
}
