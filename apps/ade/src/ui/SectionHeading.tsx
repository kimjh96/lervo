import type { MouseEvent } from "react";

import { PlusIcon } from "./icons";
import styles from "./SectionHeading.module.css";

/**
 * The heading of a sidebar section, such as "Agents" or "Conversations", with an optional quiet
 * plus that adds to the section, such as hiring an agent. The plus's accessible name says what it
 * adds.
 */
export function SectionHeading(props: {
  label: string;
  add?: { label: string; onClick: (event: MouseEvent<HTMLButtonElement>) => void };
}) {
  return (
    <div className={styles.heading}>
      <h3 className={styles.label}>{props.label}</h3>
      {props.add === undefined ? null : (
        <button
          type="button"
          className={styles.add}
          aria-label={props.add.label}
          onClick={props.add.onClick}
        >
          <PlusIcon size="sm" />
        </button>
      )}
    </div>
  );
}
