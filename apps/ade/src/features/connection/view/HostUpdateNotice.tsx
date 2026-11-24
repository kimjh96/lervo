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
 * says what restarting ends before the user chooses it. Once chosen, the button becomes the wait
 * at once and then a line that says the restart is done, since nothing else on screen shows it,
 * all in one place; the offer's text fades out in place, and later the whole notice fades out.
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
  // The offer's button becomes the wait and then the result in one place; the text above it
  // fades out in place once the restart is done.
  const action =
    update.kind === "restarting" ? "wait" : update.kind === "restarted" ? "done" : "offer";
  return (
    <div className={styles.notice} role="status">
      <Presence>
        {update.kind === "restarted" ? null : (
          <p className={styles.text}>
            {update.kind === "failed" ? (
              <FormattedMessage id="connection.update.failed" values={{ code: update.code }} />
            ) : (
              <FormattedMessage id="connection.update.available" />
            )}
          </p>
        )}
      </Presence>
      <Presence contentKey={action}>
        {action === "wait" ? (
          <Waiting immediate label={intl.formatMessage({ id: "connection.update.restarting" })} />
        ) : action === "done" ? (
          <p className={styles.text}>
            <FormattedMessage id="connection.update.restarted" />
          </p>
        ) : (
          <Button variant="outlined" onClick={() => void restartHost(replacement)}>
            <FormattedMessage id="connection.update.restart" />
          </Button>
        )}
      </Presence>
    </div>
  );
}
