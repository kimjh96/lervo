import type { ReactNode } from "react";
import { FormattedMessage, type MessageDescriptor } from "react-intl";

import { BaseNotice } from "./BaseNotice";
import styles from "./renderers.module.css";
import { Presence } from "../../../ui/Presence";

const messages = {
  product_owner: { id: "notice.start.hire_failed" },
  coordination: { id: "notice.start.coordination_unavailable" },
} as const satisfies Record<string, MessageDescriptor>;

/**
 * What new work started without, told after the fact as a Lervo notice beside the base notice:
 * the Product Owner the start card proposed, when Lervo could not hire it (ADR-0646), or claims,
 * when Lervo could not set up the work's coordination (Lervo ADE coordination).
 */
export function StartNotice(props: { without: keyof typeof messages; code: string }) {
  return (
    <p className={styles.notice} role="status">
      <span className={styles.source}>
        <FormattedMessage id="app.name" />
      </span>
      <FormattedMessage {...messages[props.without]} values={{ code: props.code }} />
    </p>
  );
}

/** The notices of work that just started, or null when it started as it should. */
export function startNotices(notices: {
  readonly baseNotice: { code: string; upstream: string | null } | null;
  readonly hireFailure: string | null;
  readonly coordinationFailure: string | null;
}): ReactNode {
  const { baseNotice, hireFailure, coordinationFailure } = notices;
  if (baseNotice === null && hireFailure === null && coordinationFailure === null) return null;
  // Each notice fades in with its space as it arrives: the hire failure comes before the
  // workspace starts, and the other two after it.
  return (
    <>
      <Presence>
        {hireFailure === null ? null : <StartNotice without="product_owner" code={hireFailure} />}
      </Presence>
      <Presence>
        {coordinationFailure === null ? null : (
          <StartNotice without="coordination" code={coordinationFailure} />
        )}
      </Presence>
      <Presence>
        {baseNotice === null ? null : (
          <BaseNotice code={baseNotice.code} upstream={baseNotice.upstream} />
        )}
      </Presence>
    </>
  );
}
