import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { useApplicationCommands, useSessionHostClient } from "../../../app/session-host-context";
import { switchConversationMode, useWorkspaceStore } from "../../workspaces";
import styles from "./WorkspaceHeader.module.css";

/**
 * The selected workspace's title and branch (approved mockup "2a"), with the switch between the
 * native conversation and the terminal. The workspace list and the working line show the live
 * status, so the header does not repeat it. The header also moves the window.
 */
export function WorkspaceHeader(props: {
  workspaceId: string;
  /** Skips the arrival when the header replaces the pending workspace's, which looks the same. */
  continues?: boolean;
}) {
  const intl = useIntl();
  const client = useSessionHostClient();
  const commands = useApplicationCommands();
  const [switching, setSwitching] = useState(false);
  const workspace = useWorkspaceStore((store) =>
    store.workspaces.find((item) => item.workspaceId === props.workspaceId),
  );
  if (workspace === undefined) return null;
  const toggle = (mode: "native" | "cli") => {
    if (mode === workspace.conversationMode) return;
    setSwitching(true);
    void switchConversationMode({ client, commands, workspaceId: workspace.workspaceId, mode })
      .catch(() => undefined)
      .finally(() => setSwitching(false));
  };
  return (
    <header
      className={styles.header}
      data-arrive={props.continues === true ? undefined : "true"}
      data-tauri-drag-region
    >
      <h1 className={styles.title} data-tauri-drag-region>
        {workspace.title ?? workspace.branch}
      </h1>
      <span className={styles.branch} data-tauri-drag-region>
        {workspace.branch}
      </span>
      <span className={styles.spacer} data-tauri-drag-region />
      <div
        className={styles.modes}
        role="group"
        aria-label={intl.formatMessage({ id: "workspace.mode.label" })}
      >
        {(["native", "cli"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={workspace.conversationMode === mode}
            disabled={switching}
            onClick={() => toggle(mode)}
          >
            <FormattedMessage id={`workspace.mode.${mode}`} />
          </button>
        ))}
      </div>
    </header>
  );
}
