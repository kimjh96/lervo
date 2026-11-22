import { FormattedMessage } from "react-intl";

import styles from "./StartScreen.module.css";

/** The start screen. S1.5b adds the instruction input and the repository choice. */
export function StartScreen() {
  return (
    <section className={styles.start}>
      <h1 className={styles.question}>
        <FormattedMessage id="start.question" />
      </h1>
    </section>
  );
}
