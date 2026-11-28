import type { TurnSummary } from "@lervo/session-host-contract";
import { type ReactNode, useCallback, useLayoutEffect } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import type { PreparedImage } from "../../../ports";
import { InlineAlert } from "../../../ui/InlineAlert";
import { Waiting } from "../../../ui/Waiting";
import { WorkingLine } from "../../../ui/WorkingLine";
import { Presence } from "../../../ui/Presence";
import { sentImages } from "../model/images";
import type { ConversationSource } from "../model/source";
import { useConversationStore } from "../model/store";
import { Composer } from "./Composer";
import { Conversation } from "./Conversation";
import { ConversationImagesProvider } from "./ConversationImages";
import styles from "./ConversationPane.module.css";
import { type AnswerQuestion, QuestionAnswers } from "./questions-context";
import { ToolLinesProvider } from "./ToolLinesProvider";
import { TurnSummariesProvider, type TurnWindow } from "./TurnSummariesProvider";
import type { Mentionable } from "../model/mentionables";

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
  /** A Lervo notice under the first message, such as what the work started without. */
  notice?: ReactNode;
  /** Sends a reply; the source's own send when absent. */
  onSend?: ((text: string, images: readonly PreparedImage[]) => Promise<void>) | undefined;
  /** Whether the session host and the core carry images in a reply. */
  acceptsImages?: boolean | undefined;
  /** The agents the reply card's `@` offers (Lervo ADE rooms). */
  mentionables?: readonly Mentionable[] | undefined;
  /** When a reply was sent while the agent worked, so it waits for the agent's next step. */
  queuedSince?: number | null | undefined;
  /** Asks the core what it recorded about a turn; without it, no turn summary shows. */
  summarize?: ((window: TurnWindow) => Promise<TurnSummary | null>) | undefined;
  /** Answers an agent's question with choices; without it, the choices show as text. */
  onAnswer?: AnswerQuestion | undefined;
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
  const readImage = useCallback((imageId: string) => source.readImage(imageId), [source]);
  return (
    <div className={styles.pane}>
      {/* The wait's place covers the pane and centers it; Presence keeps its layers at the start
          of their own place, so the centering stays outside it. */}
      <div className={styles.opening}>
        <Presence>
          {opening ? (
            <Waiting label={intl.formatMessage({ id: "conversation.opening" })} justify="center" />
          ) : null}
        </Presence>
      </div>
      <Presence className={styles.error}>
        {error === null ? null : (
          <InlineAlert size="meta">
            <FormattedMessage id="conversation.unavailable" values={{ code: error }} />
          </InlineAlert>
        )}
      </Presence>
      <QuestionAnswers answer={props.onAnswer}>
        <TurnSummariesProvider conversation={source} summarize={props.summarize}>
          <ToolLinesProvider conversation={source}>
            <ConversationImagesProvider read={readImage}>
              <Conversation
                onLoadEarlier={() => void source.loadEarlier()}
                onLoadLater={() => void source.loadLater()}
                onJumpToLatest={() => void source.showLatest()}
                continues={props.continues}
                lead={props.notice}
                turnOpen={props.working !== null}
                queuedSince={props.queuedSince ?? null}
                dock={
                  <>
                    {/* The working line keeps its row, so the conversation never moves as work starts
                or ends. */}
                    <div className={styles.working} data-working-line="">
                      <Presence>
                        {props.working === null ? null : <WorkingLine label={props.working} />}
                      </Presence>
                    </div>
                    <Composer
                      draftKey={props.draftKey}
                      onSend={
                        props.onSend ?? ((text, images) => source.send(text, sentImages(images)))
                      }
                      acceptsImages={props.acceptsImages}
                      mentionables={props.mentionables}
                      onStop={props.onStop}
                      waiting={props.waiting}
                    />
                  </>
                }
              />
            </ConversationImagesProvider>
          </ToolLinesProvider>
        </TurnSummariesProvider>
      </QuestionAnswers>
    </div>
  );
}
