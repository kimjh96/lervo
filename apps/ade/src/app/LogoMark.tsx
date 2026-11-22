import styles from "./LogoMark.module.css";

interface LogoMarkProps {
  readonly size: number;
}

/** The Lervo mark: three stepped bars whose last bar takes the brand blue. */
export function LogoMark({ size }: LogoMarkProps) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" focusable="false">
      <rect x="7" y="8" width="24" height="9" rx="4.5" className={styles.firstStep} />
      <rect x="12" y="19.5" width="24" height="9" rx="4.5" className={styles.secondStep} />
      <rect x="17" y="31" width="24" height="9" rx="4.5" className={styles.lastStep} />
    </svg>
  );
}
