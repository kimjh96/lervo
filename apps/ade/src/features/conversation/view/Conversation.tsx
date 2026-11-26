import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
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

const NEAR_EDGE_PX = 48;
/** The key of the conversation's first row. */
const FIRST_ROW = "first-row";
/** The most frames a list stays hidden while its measured height settles. */
const PLACE_FRAMES = 12;
/** How close to the bottom counts as the live end, so a bounce at the bottom stays there. */
const LIVE_END_PX = 4;
/** How long after a wheel, key, or drag a scroll counts as the user's. */
const USER_SCROLL_MS = 300;
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

/** Where the reader is: the first visible item and how far its top sits above the viewport. */
interface Anchor {
  readonly itemId: string;
  readonly offset: number;
}

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
  const room = useMemo(
    () => roomView(lead, leadAgentId, Object.values(members)),
    [lead, leadAgentId, members],
  );
  const window = room.window;
  // The questions whose choices still wait for the person (Lervo ADE sessions, "Questions").
  const openNow = useMemo(() => openQuestions(window.items, !window.hasLater), [window]);
  const arrived = useConversationStore((store) => store.arrived);
  const scroller = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const [dockHeight, setDockHeight] = useState(0);
  const items = useRef(window.items);
  items.current = window.items;
  const anchor = useRef<Anchor | null>(null);
  /** The position the view last scrolled to itself, whose scroll event is not the user's. */
  const selfScrolled = useRef<number | null>(null);
  const handlers = useRef(props);
  handlers.current = props;
  const [following, setFollowing] = useState(true);
  // The list shows once its items are measured and it rests at its end, so the estimated first
  // layout and the scroll to the end never show; it then arrives with the view. A list that
  // continues one already on screen, such as new work's first message, shows at once.
  const [placed, setPlaced] = useState<"now" | "arrive" | null>(null);
  const hasItems = window.items.length > 0;
  const continues = props.continues === true;
  const live = following && !window.hasLater;
  const liveNow = useRef(live);
  liveNow.current = live;
  // The interface does not use the React Compiler, so the virtualizer's unmemoizable functions
  // need no compiler support.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: window.items.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 72,
    // The conversation's first item keeps one key, so the session's copy of the first message
    // replaces the stand-in of work just sent in place instead of mounting its row again.
    getItemKey: (index) =>
      index === 0 && !window.hasEarlier ? FIRST_ROW : (window.items[index]?.itemId ?? index),
    overscan: 8,
  });
  const last = window.items.at(-1);
  const lastLength = last !== undefined && "text" in last ? last.text.length : 0;
  const totalSize = virtualizer.getTotalSize();
  const firstItemId = window.items[0]?.itemId;
  const firstShown = useRef(firstItemId);
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
  /** The list's height when the user last opened or closed a tool line, until it is measured. */
  const toggledAt = useRef<number | null>(null);

  // The list keeps room below its last item for the dock, whose height follows the reply's text.
  useLayoutEffect(() => {
    const element = dock.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => setDockHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A tool line the user opens or closes stays under the pointer, so the next measured height
  // does not move the view to the end.
  useLayoutEffect(() => {
    if (toggles > 0) toggledAt.current = virtualizer.getTotalSize();
  }, [toggles, virtualizer]);

  // While following, the newest text stays in view as items arrive and heights are measured.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!live || element === null) return;
    if (toggledAt.current !== null) {
      if (totalSize === toggledAt.current) return;
      toggledAt.current = null;
      // The opened line leaves the end below the view: the user is reading, and the view stops
      // following until they return to the end. A line closed at the end stays at the end.
      if (element.scrollHeight - element.scrollTop - element.clientHeight > LIVE_END_PX)
        setFollowing(false);
      return;
    }
    element.scrollTop = element.scrollHeight;
    selfScrolled.current = element.scrollTop;
  }, [live, window.items.length, lastLength, totalSize, dockHeight]);

  useLayoutEffect(() => {
    if (placed !== null || !hasItems) return;
    if (continues) {
      setPlaced("now");
      return;
    }
    // Each frame follows the end until the measured height stops changing.
    let frames = 0;
    let previous = -1;
    let frame = 0;
    const settle = () => {
      const element = scroller.current;
      if (element === null) return;
      if (liveNow.current) {
        element.scrollTop = element.scrollHeight;
        selfScrolled.current = element.scrollTop;
      }
      frames += 1;
      if (element.scrollHeight === previous || frames >= PLACE_FRAMES) setPlaced("arrive");
      else frame = requestAnimationFrame(settle);
      previous = element.scrollHeight;
    };
    frame = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(frame);
  }, [placed, hasItems, continues]);

  // When items are added or dropped above the reader, the item they read stays where it was. Only
  // a change of the first item moves items; leaving the live end must not move the view.
  useLayoutEffect(() => {
    const previous = firstShown.current;
    firstShown.current = firstItemId;
    const element = scroller.current;
    const reading = anchor.current;
    if (previous === firstItemId || liveNow.current || element === null || reading === null) return;
    const index = items.current.findIndex((item) => item.itemId === reading.itemId);
    const start = virtualizer.measurementsCache[index]?.start;
    if (start === undefined) return;
    element.scrollTop = start + reading.offset;
    selfScrolled.current = element.scrollTop;
  }, [firstItemId, virtualizer]);

  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    let dragging = false;
    let userAt = Number.NEGATIVE_INFINITY;
    let previousTop = element.scrollTop;
    const remember = () => {
      const top = element.scrollTop;
      const row = virtualizer.getVirtualItems().find((candidate) => candidate.end > top);
      const item = row === undefined ? undefined : items.current[row.index];
      anchor.current =
        row === undefined || item === undefined
          ? null
          : { itemId: item.itemId, offset: top - row.start };
    };
    // Only the user leaves the live end, by moving up with a wheel, a key, or the scroll bar, by
    // however little. Scrolls the view makes itself, such as following new text or correcting
    // measured heights, never count. The user returns to the live end by reaching the bottom.
    const user = () => (userAt = performance.now());
    const key = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) user();
    };
    const press = () => {
      dragging = true;
      user();
    };
    const release = () => (dragging = false);
    const scrolled = () => {
      remember();
      const top = element.scrollTop;
      const movedUp = top < previousTop;
      previousTop = top;
      const own = selfScrolled.current !== null && Math.abs(top - selfScrolled.current) < 1;
      selfScrolled.current = null;
      const byUser = !own && (dragging || performance.now() - userAt < USER_SCROLL_MS);
      const bottom = element.scrollHeight - top - element.clientHeight;
      // At the bottom the view is at the live end, whatever moved it there.
      if (bottom <= LIVE_END_PX) setFollowing(true);
      else if (byUser && movedUp) setFollowing(false);
      if (bottom < NEAR_EDGE_PX) handlers.current.onLoadLater();
      if (top < NEAR_EDGE_PX) handlers.current.onLoadEarlier();
    };
    element.addEventListener("scroll", scrolled, { passive: true });
    element.addEventListener("wheel", user, { passive: true });
    element.addEventListener("keydown", key);
    element.addEventListener("pointerdown", press);
    globalThis.addEventListener("pointerup", release);
    return () => {
      element.removeEventListener("scroll", scrolled);
      element.removeEventListener("wheel", user);
      element.removeEventListener("keydown", key);
      element.removeEventListener("pointerdown", press);
      globalThis.removeEventListener("pointerup", release);
    };
  }, [virtualizer]);

  const jump = () => {
    handlers.current.onJumpToLatest();
    setFollowing(true);
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
                  {/* motion: A message arrives live */}
                  {room.changes.has(item.itemId) ? (
                    <SpeakerLine agentId={room.speakers.get(item.itemId) ?? ""} />
                  ) : null}
                  <ConversationItemView item={item} />
                  <Presence className={styles.queued}>
                    {queued.has(item.itemId) ? <FormattedMessage id="conversation.queued" /> : null}
                  </Presence>
                  {/* motion: A message arrives live */}
                  {ends.has(row.index) ? (
                    <div className={styles.turnEnd}>
                      <TurnSummaryLine
                        turn={ends.get(row.index)!.turn}
                        window={ends.get(row.index)!.window}
                        elapsedMs={ends.get(row.index)!.elapsedMs}
                      />
                    </div>
                  ) : null}
                  {/* motion: Lervo notices in the conversation */}
                  {row.index === 0 && !window.hasEarlier ? (
                    <Presence className={styles.lead}>{props.lead ?? null}</Presence>
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
