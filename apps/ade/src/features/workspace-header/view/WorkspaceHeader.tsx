import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { useApplicationCommands, useSessionHostClient } from "../../../app/session-host-context";
import { StatusDot } from "../../../ui/StatusDot";
import { switchConversationMode, useWorkspaceStore, visibleStatus } from "../../workspaces";
import styles from "./WorkspaceHeader.module.css";

/**
 * The selected workspace's title, branch, and live status (approved mockup "2a"), with the
 * switch between the native conversation and the terminal. The header also moves the window.
 */
export function WorkspaceHeader(props: { workspaceId: string }) {
  const intl = useIntl();
  const client = useSessionHostClient();
  const commands = useApplicationCommands();
  const [switching, setSwitching] = useState(false);
  const workspace = useWorkspaceStore((store) =>
    store.workspaces.find((item) => item.workspaceId === props.workspaceId),
  );
  const status = useWorkspaceStore((store) =>
    workspace === undefined ? null : visibleStatus(store.statuses[workspace.sessionId]),
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
    <header className={styles.header} data-tauri-drag-region>
      <h1 className={styles.title} data-tauri-drag-region>
        {workspace.title ?? workspace.branch}
      </h1>
      <span className={styles.branch} data-tauri-drag-region>
        {workspace.branch}
      </span>
      <span className={styles.spacer} data-tauri-drag-region />
      {status === null ? null : (
        <span className={styles.status}>
          <StatusDot
            tone={status === "working" ? "working" : "attention"}
            label={intl.formatMessage({ id: `workspaces.status.${status}` })}
          />
          <FormattedMessage id={`workspaces.status.${status}`} />
        </span>
      )}
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
