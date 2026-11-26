import styles from "./StatusDot.module.css";

/**
 * The needs-you dot, with a text equivalent for assistive technology. It stays still (ADE motion,
 * "Needs-you status"); the `Presence` around it fades it in and out. Work in progress shows on the
 * row itself, as a sweeping title or a ring around a mark, never as a dot.
 */
export function StatusDot(props: { label: string }) {
  return <span className={styles.dot} role="img" aria-label={props.label} />;
}
