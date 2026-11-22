import styles from "./StatusDot.module.css";

/**
 * A status dot with a text equivalent for assistive technology. `working` breathes; `attention`
 * fades in once and stays still (ADE motion, "Working status" and "Needs-you status").
 */
export function StatusDot(props: { tone: "working" | "attention"; label: string }) {
  return <span className={styles.dot} data-tone={props.tone} role="img" aria-label={props.label} />;
}
