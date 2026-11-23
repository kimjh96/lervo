import type { ConversationMode } from "@lervo/session-host-contract";
import { useState } from "react";
import { FormattedMessage, type MessageDescriptor, useIntl } from "react-intl";

import { failureCode, useApplicationCommands, useSessionHost } from "../../../ports";
import { PaneHeader } from "../../../ui/PaneHeader";
import { switchConversationMode, useWorkspaceStore } from "../../workspaces";
import styles from "./WorkspaceHeader.module.css";

const modeMessages: Readonly<Record<ConversationMode, MessageDescriptor>> = {
  native: { id: "workspace.mode.native" },
  cli: { id: "workspace.mode.cli" },
};
const MODES = Object.keys(modeMessages) as ConversationMode[];

/**
 * The selected workspace's title and branch (approved mockup "2a"), with the switch between the
 * native conversation and the terminal. The workspace list and the working line show the live
 * status, so the header does not repeat it.
 */
export function WorkspaceHeader(props: {
  workspaceId: string;
  /** Skips the arrival when the header replaces the pending workspace's, which looks the same. */
  continues: boolean;
}) {
  const intl = useIntl();
  const host = useSessionHost();
  const commands = useApplicationCommands();
  const [switching, setSwitching] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const workspace = useWorkspaceStore((store) =>
    store.workspaces.find((item) => item.workspaceId === props.workspaceId),
  );
  if (workspace === undefined) return null;
  const toggle = (mode: ConversationMode) => {
    if (mode === workspace.conversationMode) return;
    setSwitching(true);
    setFailure(null);
    void switchConversationMode({
      client: host,
      commands,
      workspaceId: workspace.workspaceId,
      mode,
    })
      .catch((error: unknown) => setFailure(failureCode(error)))
      .finally(() => setSwitching(false));
  };
  return (
    <PaneHeader
      title={workspace.title ?? workspace.branch}
      detail={workspace.branch}
      arrive={!props.continues}
    >
      {failure === null ? null : (
        <span className={styles.failure} role="alert">
          <FormattedMessage id="workspace.mode.failed" values={{ code: failure }} />
        </span>
      )}
      <div
        className={styles.modes}
        role="group"
        aria-label={intl.formatMessage({ id: "workspace.mode.label" })}
      >
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={workspace.conversationMode === mode}
            disabled={switching}
            onClick={() => toggle(mode)}
          >
            <FormattedMessage {...modeMessages[mode]} />
          </button>
        ))}
      </div>
    </PaneHeader>
  );
}
