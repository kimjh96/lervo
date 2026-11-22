import { useEffect, useMemo } from "react";
import { FormattedMessage } from "react-intl";

import { useSessionHostClient } from "../../../app/session-host-context";
import { ConversationController, type ConversationTarget } from "../model/controller";
import { useConversationStore } from "../model/store";
import { Composer } from "./Composer";
import { Conversation } from "./Conversation";
import styles from "./WorkspaceConversation.module.css";

/** One workspace's native conversation: the controller's lifetime follows the selection. */
export function WorkspaceConversation(props: { target: ConversationTarget }) {
  const client = useSessionHostClient();
  const { workspaceId, sessionId } = props.target;
  const controller = useMemo(
    () => new ConversationController(client, { workspaceId, sessionId }),
    [client, workspaceId, sessionId],
  );
  const error = useConversationStore((store) => store.error);
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
      <Conversation onLoadEarlier={() => void controller.loadEarlier()} />
      <Composer onSend={(text) => controller.send(text)} />
    </div>
  );
}
