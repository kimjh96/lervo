import { FormattedMessage } from "react-intl";

import { useHostReplacement } from "../../../ports";
import { Button } from "../../../ui/Button";
import { useConnectionStore } from "../model/store";
import { restartHost } from "../model/update";
import styles from "./HostUpdateNotice.module.css";

/**
 * Offers to restart a session host that an older Lervo started, under the connection status. It
 * says what restarting ends before the user chooses it.
 */
export function HostUpdateNotice() {
  const update = useConnectionStore((store) => store.update);
  const replacement = useHostReplacement();
  if (update.kind === "none") return null;
  return (
    <div className={styles.notice} role="status">
      <p className={styles.text}>
        {update.kind === "available" ? <FormattedMessage id="connection.update.available" /> : null}
        {update.kind === "restarting" ? (
          <FormattedMessage id="connection.update.restarting" />
        ) : null}
        {update.kind === "failed" ? (
          <FormattedMessage id="connection.update.failed" values={{ code: update.code }} />
        ) : null}
      </p>
      {update.kind === "restarting" ? null : (
        <Button variant="outlined" onClick={() => void restartHost(replacement)}>
          <FormattedMessage id="connection.update.restart" />
        </Button>
      )}
    </div>
  );
}
