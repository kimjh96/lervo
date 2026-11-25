import { type ReactNode, useLayoutEffect } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { InlineAlert } from "../../../ui/InlineAlert";
import { Waiting } from "../../../ui/Waiting";
import { WorkingLine } from "../../../ui/WorkingLine";
import { Presence } from "../../../ui/Presence";
import type { ConversationSource } from "../model/source";
import { useConversationStore } from "../model/store";
import { Composer } from "./Composer";
import { Conversation } from "./Conversation";
import styles from "./ConversationPane.module.css";

/**
 * The conversation with its dock: the working line while the agent works, and the reply card.
 * Every conversation view renders through it, so a starting workspace and its session look the
 * same. A conversation with nothing to show yet says that it is opening, where it will appear.
 */
export function ConversationPane(props: {
  source: ConversationSource;
  /** What the agent is doing, while it works. */
  working: string | null;
  /** Where the reply card keeps its draft across reloads, when replies can be typed. */
  draftKey?: string | undefined;
  /** Shown in place of the reply card's placeholder while replies cannot be sent yet. */
  waiting?: string | undefined;
  /** Stops the agent's running turn, while it can be stopped. */
  onStop?: (() => Promise<void>) | undefined;
  /** Shows the first items at once, when the view continues one already on screen. */
  continues: boolean;
  /** A Lervo notice above the working line, such as what the work started without. */
  notice?: ReactNode;
}) {
  const intl = useIntl();
  const { source } = props;
  const error = useConversationStore((store) => store.error);
  const opening = useConversationStore(
    (store) => store.sessionId === null && store.window.items.length === 0 && store.error === null,
  );
  // Opening before paint replaces the previous conversation's window before it can show.
  useLayoutEffect(() => {
    void source.open();
    return () => source.close();
  }, [source]);
  return (
    <div className={styles.pane}>
      <Presence className={styles.opening}>
        {opening ? <Waiting label={intl.formatMessage({ id: "conversation.opening" })} /> : null}
      </Presence>
      <Presence className={styles.error}>
        {error === null ? null : (
          <InlineAlert size="meta">
            <FormattedMessage id="conversation.unavailable" values={{ code: error }} />
          </InlineAlert>
        )}
      </Presence>
      <Conversation
        onLoadEarlier={() => void source.loadEarlier()}
        onLoadLater={() => void source.loadLater()}
        onJumpToLatest={() => void source.showLatest()}
        continues={props.continues}
        dock={
          <>
            <Presence className={styles.notice}>{props.notice ?? null}</Presence>
            {/* The working line keeps its row, so the conversation never moves as work starts
                or ends. */}
            <div className={styles.working}>
              <Presence>
                {props.working === null ? null : <WorkingLine label={props.working} />}
              </Presence>
            </div>
            <Composer
              draftKey={props.draftKey}
              onSend={(text) => source.send(text)}
              onStop={props.onStop}
              waiting={props.waiting}
            />
          </>
        }
      />
    </div>
  );
}
