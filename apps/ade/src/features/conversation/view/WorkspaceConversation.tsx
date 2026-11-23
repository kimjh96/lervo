import { useMemo } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";

import { useSessionHost } from "../../../ports";
import { useWorkspaceStore, visibleStatus } from "../../workspaces";
import { activityOf } from "../model/activity";
import { ConversationController } from "../model/controller";
import { useConversationStore } from "../model/store";
import { ConversationPane } from "./ConversationPane";
import { activityMessages } from "./messages";

/** One workspace's native conversation: the controller's lifetime follows the session. */
export function WorkspaceConversation(props: {
  workspaceId: string;
  sessionId: string;
  /** The instruction that started the work, when the view continues the starting workspace. */
  firstMessage?: string | undefined;
  /** Whether the session last ran in another mode and must reopen in the native conversation. */
  reopenNatively?: boolean;
}) {
  const intl = useIntl();
  const host = useSessionHost();
  const { workspaceId, sessionId, firstMessage, reopenNatively = false } = props;
  const controller = useMemo(
    () =>
      new ConversationController(host, {
        workspaceId,
        sessionId,
        reopenNatively,
        ...(firstMessage === undefined ? {} : { firstMessage }),
      }),
    [host, workspaceId, sessionId, firstMessage, reopenNatively],
  );
  const working = useWorkspaceStore(
    (store) => visibleStatus(store.statuses[sessionId]) === "working",
  );
  const activity = useConversationStore(useShallow((store) => activityOf(store.window)));
  const label = intl.formatMessage(
    activityMessages[activity.kind],
    activity.kind === "tool" ? { name: activity.name } : {},
  );
  return (
    <ConversationPane
      source={controller}
      working={working ? label : null}
      draftKey={`reply:${workspaceId}`}
      continues={firstMessage !== undefined}
    />
  );
}
