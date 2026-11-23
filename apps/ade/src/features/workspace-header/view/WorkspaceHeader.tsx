import type { ConversationMode } from "@lervo/session-host-contract";
import { useState } from "react";
import { FormattedMessage, type MessageDescriptor, useIntl } from "react-intl";

import { failureCode, useApplicationCommands, useSessionHost } from "../../../ports";
import { InlineAlert } from "../../../ui/InlineAlert";
import { PaneHeader } from "../../../ui/PaneHeader";
import { SegmentedControl } from "../../../ui/SegmentedControl";
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
        <InlineAlert size="caption" className={styles.failure}>
          <FormattedMessage id="workspace.mode.failed" values={{ code: failure }} />
        </InlineAlert>
      )}
      <SegmentedControl
        label={intl.formatMessage({ id: "workspace.mode.label" })}
        options={MODES.map((mode) => ({
          value: mode,
          text: intl.formatMessage(modeMessages[mode]),
        }))}
        value={workspace.conversationMode}
        onChange={toggle}
        disabled={switching}
      />
    </PaneHeader>
  );
}
