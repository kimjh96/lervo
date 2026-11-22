import { FormattedMessage } from "react-intl";

import styles from "./WorkspaceList.module.css";

/** The workspace list. S1.5b fills it from the core; until then it shows its empty state. */
export function WorkspaceList() {
  return (
    <section className={styles.list} aria-labelledby="workspaces-title">
      <h2 id="workspaces-title" className={styles.title}>
        <FormattedMessage id="workspaces.title" />
      </h2>
      <p className={styles.empty}>
        <FormattedMessage id="workspaces.empty" />
      </p>
    </section>
  );
}
