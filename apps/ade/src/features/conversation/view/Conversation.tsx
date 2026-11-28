import {
  type CSSProperties,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FormattedMessage } from "react-intl";

import { FloatingButton } from "../../../ui/FloatingButton";
import { Presence } from "../../../ui/Presence";
import { openQuestions } from "../model/questions";
import { roomView } from "../model/room";
import { withAnswers } from "../model/room-answers";
import { useRoomStore } from "../model/room-store";
import { useConversationStore } from "../model/store";
import styles from "./Conversation.module.css";
import { OpenQuestions } from "./questions-context";
import { ConversationItemView } from "./renderers";
import { useToolLineToggles } from "./ToolLinesProvider";
import { queuedReplies, type TurnEnd, turnEnds } from "../model/turns";
import { useShowsTurnSummaries } from "./TurnSummariesProvider";
import { TurnSummaryLine } from "./TurnSummaryLine";
import { SpeakerLine } from "./SpeakerLine";
import { useFollowLatest } from "./follow-latest";

/**
 * The native conversation, virtualized: only items near the viewport mount, and their heights
 * are measured once per item. It follows the live end until the user scrolls up, by however
 * little, and then offers "Jump to latest" (ADE motion, "Following the stream"). Pages load at
 * either edge of the window, and the item the user is reading stays in place when items are
 * added or dropped above it.
 *
 * The conversation runs to the bottom of the window, and `dock`, such as the reply card, floats
 * over it on glass; the list keeps room for the dock below its last item.
 */
export function Conversation(props: {
  onLoadEarlier: () => void;
  onLoadLater: () => void;
  onJumpToLatest: () => void;
  dock: ReactNode;
  /** Shows the first items at once, when the view continues one already on screen. */
  continues?: boolean | undefined;
  /**
   * A Lervo notice under the first message, such as what the work started without. It belongs to
   * the conversation, so it scrolls with it instead of floating over it.
   */
  lead?: ReactNode;
  /** Whether the agent still works on the last turn, which then has no summary yet. */
  turnOpen?: boolean | undefined;
  /** When a reply was sent while the agent worked; such replies say they wait until it answers. */
  queuedSince?: number | null | undefined;
}) {
  // A conversation with joined agents is one timeline of their sessions (Lervo ADE rooms).
  const lead = useConversationStore((store) => store.window);
  const leadAgentId = useRoomStore((store) => store.leadAgentId);
  const members = useRoomStore((store) => store.members);
  const answers = useRoomStore((store) => store.answers);
  const room = useMemo(() => {
    const view = roomView(lead, leadAgentId, Object.values(members));
    // What the lead answered in other conversations joins the timeline at its times.
    return { ...view, window: withAnswers(view.window, answers) };
  }, [lead, leadAgentId, members, answers]);
  const window = room.window;
  // The questions whose choices still wait for the person (Lervo ADE sessions, "Questions").
  const openNow = useMemo(() => openQuestions(window.items, !window.hasLater), [window]);
  const arrived = useConversationStore((store) => store.arrived);
  const scroller = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const [dockHeight, setDockHeight] = useState(0);
  const toggles = useToolLineToggles();
  const showsSummaries = useShowsTurnSummaries();
  const turnOpen = props.turnOpen === true;
  // Each finished turn's last item carries the turn's summary.
  const ends = useMemo(
    () => (showsSummaries ? turnEnds(window.items, turnOpen) : new Map<number, TurnEnd>()),
    [window.items, turnOpen, showsSummaries],
  );
  // A reply sent while the agent worked says it waits until the agent's next item arrives.
  const queuedSince = props.queuedSince ?? null;
  const queued = useMemo(
    () => queuedReplies(window.items, queuedSince),
    [window.items, queuedSince],
  );

  // The list keeps room below its last item for the dock, whose height follows the reply's text.
  useLayoutEffect(() => {
    const element = dock.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => setDockHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { virtualizer, live, placed, follow } = useFollowLatest({
    scroller,
    items: window.items,
    hasEarlier: window.hasEarlier,
    hasLater: window.hasLater,
    continues: props.continues === true,
    dockHeight,
    toggles,
    onLoadEarlier: () => props.onLoadEarlier(),
    onLoadLater: () => props.onLoadLater(),
  });
  const totalSize = virtualizer.getTotalSize();
  const jump = () => {
    props.onJumpToLatest();
    follow();
  };

  return (
    <OpenQuestions open={openNow}>
      <div className={styles.frame} style={{ "--dock-height": `${dockHeight}px` } as CSSProperties}>
        <div
          ref={scroller}
          className={styles.scroller}
          data-live={live ? "true" : undefined}
          role="log"
          aria-live="polite"
          // The log scrolls, so it takes keyboard focus for the arrow and page keys.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
        >
          <div
            className={styles.list}
            data-placed={placed ?? undefined}
            style={{ height: totalSize }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const item = window.items[row.index];
              if (item === undefined) return null;
              return (
                <div
                  key={row.key}
                  ref={virtualizer.measureElement}
                  data-index={row.index}
                  data-kind={item.kind}
                  data-follows={window.items[row.index - 1]?.kind}
                  className={styles.row}
                  data-arrived={arrived.has(item.itemId) ? "true" : undefined}
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  {/* A speaker line comes and goes with its space when agents join or a joined
                      agent's item lands between others; a row that mounts with it shows it at
                      once, since the row itself arrives or was already read. */}
                  <Presence enterOnMount={false}>
                    {room.changes.has(item.itemId) ? (
                      <SpeakerLine agentId={room.speakers.get(item.itemId) ?? ""} />
                    ) : null}
                  </Presence>
                  <ConversationItemView item={item} />
                  <Presence className={styles.queued} enterOnMount={false}>
                    {queued.has(item.itemId) ? <FormattedMessage id="conversation.queued" /> : null}
                  </Presence>
                  <TurnEndLine end={ends.get(row.index)} />
                  {/* motion: Lervo notices in the conversation */}
                  {row.index === 0 && !window.hasEarlier ? (
                    <Presence className={styles.lead} enterOnMount={false}>
                      {props.lead ?? null}
                    </Presence>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        <div ref={dock} className={styles.dock}>
          <Presence arrival="rise">
            {live ? null : (
              <FloatingButton className={styles.jump} onClick={jump}>
                <FormattedMessage id="conversation.jumpToLatest" />
              </FloatingButton>
            )}
          </Presence>
          {props.dock}
        </div>
      </div>
    </OpenQuestions>
  );
}

/**
 * A finished turn's line under its last item. It comes when the turn ends and goes if the turn
 * opens again, fading with its space; a row that mounts with it shows it at once.
 */
function TurnEndLine(props: { end: TurnEnd | undefined }) {
  const { end } = props;
  return (
    <Presence enterOnMount={false}>
      {end === undefined ? null : (
        <div className={styles.turnEnd}>
          <TurnSummaryLine turn={end.turn} window={end.window} elapsedMs={end.elapsedMs} />
        </div>
      )}
    </Presence>
  );
}
