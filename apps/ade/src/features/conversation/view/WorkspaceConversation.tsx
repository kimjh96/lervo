import { useEffect, useMemo } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { useSessionHostClient } from "../../../app/session-host-context";
import { WorkingLine } from "../../../ui/WorkingLine";
import { useWorkspaceStore, visibleStatus } from "../../workspaces";
import { activityOf } from "../model/activity";
import { ConversationController, type ConversationTarget } from "../model/controller";
import { useConversationStore } from "../model/store";
import { Composer } from "./Composer";
import { Conversation } from "./Conversation";
import styles from "./WorkspaceConversation.module.css";

/** One workspace's native conversation: the controller's lifetime follows the selection. */
export function WorkspaceConversation(props: { target: ConversationTarget }) {
  const intl = useIntl();
  const client = useSessionHostClient();
  const { workspaceId, sessionId, firstMessage } = props.target;
  const controller = useMemo(
    () =>
      new ConversationController(client, {
        workspaceId,
        sessionId,
        ...(firstMessage === undefined ? {} : { firstMessage }),
      }),
    [client, workspaceId, sessionId, firstMessage],
  );
  const error = useConversationStore((store) => store.error);
  const working = useWorkspaceStore(
    (store) => visibleStatus(store.statuses[sessionId]) === "working",
  );
  // The selector returns a string, so the store's snapshot stays stable between changes.
  const activity = useConversationStore((store) => {
    const current = activityOf(store.window);
    return current.kind === "tool" ? `tool:${current.name}` : current.kind;
  });
  const label = activity.startsWith("tool:")
    ? intl.formatMessage({ id: "conversation.tool.running" }, { name: activity.slice(5) })
    : intl.formatMessage({ id: `conversation.activity.${activity}` });
  useEffect(() => {
    void controller.open();
    return () => controller.close();
  }, [controller]);
  return (
    <div className={styles.conversation}>
      {error === null ? null : (
        <p className={styles.error} role="alert">
          <FormattedMessage id="conversation.unavailable" values={{ code: error }} />
        </p>
      )}
      <Conversation
        onLoadEarlier={() => void controller.loadEarlier()}
        onLoadLater={() => void controller.loadLater()}
        onJumpToLatest={() => void controller.showLatest()}
        dock={
          <>
            {working ? <WorkingLine className={styles.working} label={label} /> : null}
            <Composer onSend={(text) => controller.send(text)} />
          </>
        }
      />
    </div>
  );
}
