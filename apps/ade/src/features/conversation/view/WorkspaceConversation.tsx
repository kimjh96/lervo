import { useEffect, useMemo } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { useSessionHostClient } from "../../../app/session-host-context";
import { StatusDot } from "../../../ui/StatusDot";
import { useWorkspaceStore, visibleStatus } from "../../workspaces";
import { ConversationController, type ConversationTarget } from "../model/controller";
import { useConversationStore } from "../model/store";
import { Composer } from "./Composer";
import { Conversation } from "./Conversation";
import styles from "./WorkspaceConversation.module.css";

/** One workspace's native conversation: the controller's lifetime follows the selection. */
export function WorkspaceConversation(props: { target: ConversationTarget }) {
  const intl = useIntl();
  const client = useSessionHostClient();
  const { workspaceId, sessionId } = props.target;
  const controller = useMemo(
    () => new ConversationController(client, { workspaceId, sessionId }),
    [client, workspaceId, sessionId],
  );
  const error = useConversationStore((store) => store.error);
  const working = useWorkspaceStore(
    (store) => visibleStatus(store.statuses[sessionId]) === "working",
  );
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
            {working ? (
              <p className={styles.working}>
                <StatusDot
                  tone="working"
                  label={intl.formatMessage({ id: "workspaces.status.working" })}
                />
                <FormattedMessage id="workspaces.status.working" />
              </p>
            ) : null}
            <Composer onSend={(text) => controller.send(text)} />
          </>
        }
      />
    </div>
  );
}
