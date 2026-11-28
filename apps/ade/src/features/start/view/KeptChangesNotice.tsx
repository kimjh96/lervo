import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { useClipboard } from "../../../ports";
import { Button } from "../../../ui/Button";
import { Presence } from "../../../ui/Presence";
import { useKeptChanges } from "../../workspaces";
import styles from "./KeptChangesNotice.module.css";

/**
 * After a workspace was removed with its changes (Lervo ADE sessions, "Retiring a workspace"): one
 * plain sentence that Lervo kept them, and a press that copies the command that brings them back,
 * so the notice never shows a raw Git command. It stays until the person dismisses it or removes
 * another workspace.
 */
export function KeptChangesNotice() {
  const restore = useKeptChanges((state) => state.restore);
  const dismiss = useKeptChanges((state) => state.dismiss);
  const intl = useIntl();
  const clipboard = useClipboard();
  const [copied, setCopied] = useState(false);
  const copy = (text: string) =>
    void clipboard.copy(text).then(
      () => setCopied(true),
      () => undefined,
    );
  return (
    <Presence>
      {/* motion: Coming and going */}
      {restore === null ? null : (
        <div className={styles.notice} role="status">
          <p className={styles.text}>
            <FormattedMessage id="start.keptChanges" />
          </p>
          <span className={styles.actions}>
            <Button variant="quiet" onClick={() => copy(restore)}>
              <Presence as="span" contentKey={copied ? "copied" : "copy"}>
                {copied
                  ? intl.formatMessage({ id: "start.keptChanges.copied" })
                  : intl.formatMessage({ id: "start.keptChanges.copy" })}
              </Presence>
            </Button>
            <Button variant="quiet" onClick={dismiss}>
              <FormattedMessage id="start.keptChanges.dismiss" />
            </Button>
          </span>
        </div>
      )}
    </Presence>
  );
}
