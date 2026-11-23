import { useMemo } from "react";
import { useIntl } from "react-intl";

import { StandInConversation } from "../model/stand-in-conversation";
import { ConversationPane } from "./ConversationPane";
import { activityMessages } from "./messages";

/**
 * The conversation of work just sent, while the core creates its workspace (ADE motion,
 * "Starting work"): the instruction as the first message, the working line, and a reply card
 * that waits for the session.
 */
export function StartingConversation(props: { firstMessage: string }) {
  const intl = useIntl();
  const source = useMemo(() => new StandInConversation(props.firstMessage), [props.firstMessage]);
  return (
    <ConversationPane
      source={source}
      working={intl.formatMessage(activityMessages.starting)}
      waiting={intl.formatMessage({ id: "conversation.reply.starting" })}
      continues
    />
  );
}
