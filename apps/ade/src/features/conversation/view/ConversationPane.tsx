import { useLayoutEffect } from "react";
import { FormattedMessage } from "react-intl";

import { WorkingLine } from "../../../ui/WorkingLine";
import type { ConversationSource } from "../model/source";
import { useConversationStore } from "../model/store";
import { Composer } from "./Composer";
import { Conversation } from "./Conversation";
import styles from "./ConversationPane.module.css";

/**
 * The conversation with its dock: the working line while the agent works, and the reply card.
 * Every conversation view renders through it, so a starting workspace and its session look the
 * same.
 */
export function ConversationPane(props: {
  source: ConversationSource;
  /** What the agent is doing, while it works. */
  working: string | null;
  /** Where the reply card keeps its draft across reloads, when replies can be typed. */
  draftKey?: string | undefined;
  /** Shown in place of the reply card's placeholder while replies cannot be sent yet. */
  waiting?: string | undefined;
  /** Shows the first items at once, when the view continues one already on screen. */
  continues: boolean;
}) {
  const { source } = props;
  const error = useConversationStore((store) => store.error);
  // Opening before paint replaces the previous conversation's window before it can show.
  useLayoutEffect(() => {
    void source.open();
    return () => source.close();
  }, [source]);
  return (
    <div className={styles.pane}>
      {error === null ? null : (
        <p className={styles.error} role="alert">
          <FormattedMessage id="conversation.unavailable" values={{ code: error }} />
        </p>
      )}
      <Conversation
        onLoadEarlier={() => void source.loadEarlier()}
        onLoadLater={() => void source.loadLater()}
        onJumpToLatest={() => void source.showLatest()}
        continues={props.continues}
        dock={
          <>
            {props.working === null ? null : (
              <WorkingLine className={styles.working} label={props.working} />
            )}
            <Composer
              draftKey={props.draftKey}
              onSend={(text) => source.send(text)}
              waiting={props.waiting}
            />
          </>
        }
      />
    </div>
  );
}
