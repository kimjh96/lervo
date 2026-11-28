import { useLayoutEffect, useRef } from "react";

import styles from "./WorkingLabel.module.css";

/**
 * A list row's title. While its work runs, the title rests one step quieter and a band of light
 * sweeps across it, the working line's motion, so a working row needs no dot (ADE motion,
 * "Working status"). Every sweeping title shares one clock, so several working rows move as one.
 * The status reaches assistive technology as text after the title.
 */
export function WorkingLabel(props: { title: string; working: string | null }) {
  const label = useRef<HTMLSpanElement>(null);
  const working = props.working !== null;
  useLayoutEffect(() => {
    const element = label.current;
    if (!working || element === null || typeof element.getAnimations !== "function") return;
    // A start at the timeline's origin puts every sweep on the same phase.
    for (const animation of element.getAnimations()) animation.startTime = 0;
  }, [working]);
  return (
    <>
      <span ref={label} className={styles.title} data-working={working ? "" : undefined}>
        {props.title}
      </span>
      {/* motion: Working status */}
      {props.working === null ? null : <span className={styles.status}>{props.working}</span>}
    </>
  );
}
