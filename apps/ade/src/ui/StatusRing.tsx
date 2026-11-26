import type { ReactNode } from "react";
import { useState } from "react";

import styles from "./StatusRing.module.css";

export type RingTone = "working" | "attention";

/**
 * A thin ring around an agent's mark: blue and breathing while the agent works, amber and still
 * while it needs the person (ADE motion, "Working status" and "Needs-you status"). The ring fades
 * in and out in its last color, and carries the status as text for assistive technology.
 */
export function StatusRing(props: {
  tone: RingTone | null;
  label: string | null;
  children: ReactNode;
}) {
  // The last tone stays, so a ring that leaves fades out in the color it had.
  const [last, setLast] = useState<RingTone>(props.tone ?? "working");
  if (props.tone !== null && props.tone !== last) setLast(props.tone);
  const shown = props.tone !== null && props.label !== null;
  return (
    <span
      className={styles.ring}
      data-tone={props.tone ?? last}
      data-shown={shown ? "" : undefined}
      role={shown ? "img" : undefined}
      aria-label={shown ? (props.label ?? undefined) : undefined}
    >
      {props.children}
    </span>
  );
}
