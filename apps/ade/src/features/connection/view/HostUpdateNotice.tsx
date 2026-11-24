import { FormattedMessage, useIntl } from "react-intl";

import { useHostReplacement } from "../../../ports";
import { Button } from "../../../ui/Button";
import { Waiting } from "../../../ui/Waiting";
import { useConnectionStore } from "../model/store";
import { restartHost } from "../model/update";
import styles from "./HostUpdateNotice.module.css";

/**
 * Offers to restart a session host that an older Lervo started, under the connection status. It
 * says what restarting ends before the user chooses it, and then what Lervo is doing in place of
 * the button.
 */
export function HostUpdateNotice() {
  const intl = useIntl();
  const update = useConnectionStore((store) => store.update);
  const replacement = useHostReplacement();
  if (update.kind === "none") return null;
  if (update.kind === "restarting")
    return (
      <div className={styles.notice}>
        <Waiting label={intl.formatMessage({ id: "connection.update.restarting" })} />
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
