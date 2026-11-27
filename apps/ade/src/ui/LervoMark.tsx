import styles from "./LervoMark.module.css";

/**
 * The Lervo mark (ADE visual language, "Logo"): three stepped bars on a 48-unit grid, the first two
 * in the text color at 38% and 68%, the last in the brand blue. It is decorative beside the name
 * it stands for.
 */
export function LervoMark(props: { size: "welcome" | "launch" }) {
  return (
    <svg className={styles.mark} data-size={props.size} viewBox="0 0 48 48" aria-hidden="true">
      <rect x="7" y="8" width="24" height="9" rx="4.5" fillOpacity="0.38" />
      <rect x="12" y="19.5" width="24" height="9" rx="4.5" fillOpacity="0.68" />
      <rect className={styles.accent} x="17" y="31" width="24" height="9" rx="4.5" />
    </svg>
  );
}
