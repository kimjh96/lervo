import { type ReactNode, useEffect, useRef } from "react";

import styles from "./Button.module.css";

/**
 * A secondary button in a bar, such as a header's controls: quiet text or a quiet icon, or an
 * outlined button for the action a question asks about. An icon-only button needs `label`, its
 * accessible name. The one primary action of an input card is an `IconButton` instead.
 */
export function Button(props: {
  children: ReactNode;
  variant: "quiet" | "outlined";
  onClick: () => void;
  /** The accessible name of an icon-only button; text buttons name themselves. */
  label?: string;
  disabled?: boolean;
  /** Takes the focus when it appears, as a question's safe answer does. */
  takesFocus?: boolean;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const { takesFocus } = props;
  useEffect(() => {
    if (takesFocus === true) button.current?.focus();
  }, [takesFocus]);
  return (
    <button
      ref={button}
      type="button"
      className={styles.button}
      data-variant={props.variant}
      data-icon-only={props.label === undefined ? undefined : ""}
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
