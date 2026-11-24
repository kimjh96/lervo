import styles from "./WorkingLine.module.css";
import { Presence } from "./Presence";

/**
 * What an agent is doing right now, such as "Writing a reply". A highlight sweeps across the
 * words while the work lasts, so the line reads as alive without moving the layout (ADE motion,
 * "Working status"). It is the conversation's only looping motion, and it stops under reduced
 * motion and while the window is hidden. When the activity changes, the words crossfade in place.
 */
export function WorkingLine(props: { label: string; className?: string | undefined }) {
  return (
    <p className={[styles.line, props.className].filter(Boolean).join(" ")} role="status">
      <span className={styles.dot} aria-hidden="true" />
      <Presence as="span" contentKey={props.label}>
        <span className={styles.label}>{props.label}</span>
      </Presence>
    </p>
  );
}
