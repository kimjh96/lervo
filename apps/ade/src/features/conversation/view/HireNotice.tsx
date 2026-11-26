import { FormattedMessage } from "react-intl";

import styles from "./renderers.module.css";

/**
 * That the work started without the Product Owner the start card proposed, because Lervo could
 * not hire it (ADR-0646), told after the fact as a Lervo notice beside the base notice.
 */
export function HireNotice(props: { code: string }) {
  return (
    <p className={styles.notice} role="status">
      <span className={styles.source}>
        <FormattedMessage id="app.name" />
      </span>
      <FormattedMessage id="notice.start.hire_failed" values={{ code: props.code }} />
    </p>
  );
}
