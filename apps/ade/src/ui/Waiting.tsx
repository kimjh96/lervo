import { useEffect, useState } from "react";

import { motion } from "../design/generated/motion";
import styles from "./Waiting.module.css";

/**
 * A wait Lervo names, where it happens (ADE design patterns, "Waiting"): in place of the control
 * an action came from, such as "Stopping the session", where a view's content will appear, such
 * as "Opening the conversation", or in the connection status. It names the activity without an
 * ellipsis and carries the working line's highlight, so every wait looks alike. It shows nothing
 * until `motion.duration.wait` passes, because most waits end sooner and a line that flashes for
 * a few frames reads as a fault; the first connection waits `motion.duration.waitLaunch`. A new
 * label replaces the old one in place, so the steps of one action read as one line.
 */
export function Waiting(props: {
  label: string;
  /** Only the first connection's status waits longer, while the kept lists show. */
  launch?: boolean;
  className?: string | undefined;
}) {
  const [shown, setShown] = useState(false);
  const delay = props.launch === true ? motion.waitLaunchMs : motion.waitMs;
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);
  return (
    <span className={[styles.waiting, props.className].filter(Boolean).join(" ")} role="status">
      {shown ? (
        <span className={styles.appear}>
          <span className={styles.label}>{props.label}</span>
        </span>
      ) : null}
    </span>
  );
}
