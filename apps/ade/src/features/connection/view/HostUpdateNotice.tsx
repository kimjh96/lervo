import { useEffect } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { motion } from "../../../design/generated/motion";
import { useHostReplacement } from "../../../ports";
import { Button } from "../../../ui/Button";
import { Presence } from "../../../ui/Presence";
import { Waiting } from "../../../ui/Waiting";
import { type HostUpdate, useConnectionStore } from "../model/store";
import { restartHost, settleHostUpdate } from "../model/update";
import styles from "./HostUpdateNotice.module.css";

/**
 * Offers to restart a session host that an older Lervo started, under the connection status. It
 * says what restarting ends before the user chooses it, then what Lervo is doing in place of the
 * button, and finally that the restart is done, since nothing else on screen shows it. Each
 * state replaces the last in place, and the notice fades out when it ends.
 */
export function HostUpdateNotice() {
  const update = useConnectionStore((store) => store.update);
  useEffect(() => {
    if (update.kind !== "restarted") return;
    const timer = setTimeout(settleHostUpdate, motion.settleMs);
    return () => clearTimeout(timer);
  }, [update.kind]);
  return <Presence>{update.kind === "none" ? null : <Notice update={update} />}</Presence>;
}

function Notice(props: { update: Exclude<HostUpdate, { kind: "none" }> }) {
  const intl = useIntl();
  const replacement = useHostReplacement();
  const { update } = props;
  if (update.kind === "restarting")
    return (
      <div className={styles.notice}>
        <Waiting label={intl.formatMessage({ id: "connection.update.restarting" })} />
      </div>
    );
  if (update.kind === "restarted")
    return (
      <div className={styles.notice} role="status">
        <p className={styles.text}>
          <FormattedMessage id="connection.update.restarted" />
        </p>
      </div>
    );
  return (
    <div className={styles.notice} role="status">
      <p className={styles.text}>
        {update.kind === "available" ? (
          <FormattedMessage id="connection.update.available" />
        ) : (
          <FormattedMessage id="connection.update.failed" values={{ code: update.code }} />
        )}
      </p>
      <Button variant="outlined" onClick={() => void restartHost(replacement)}>
        <FormattedMessage id="connection.update.restart" />
      </Button>
    </div>
  );
}
