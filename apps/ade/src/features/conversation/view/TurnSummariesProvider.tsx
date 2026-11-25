import type { TurnSummary } from "@lervo/session-host-contract";
import { createContext, type PropsWithChildren, useContext, useState } from "react";
import { createStore, type StoreApi, useStore } from "zustand";

/** A turn as the conversation names it: when its message was sent, and when the next one was. */
export interface TurnWindow {
  readonly startedAtMs: number;
  readonly endedAtMs?: number;
}

/** What the core recorded about one turn, once asked: its summary, or null when it has none. */
type Entry =
  { readonly state: "loading" } | { readonly state: "ready"; readonly summary: TurnSummary | null };

interface TurnSummariesState {
  readonly entries: Readonly<Record<string, Entry>>;
  /** Turns whose summary card the user opened. */
  readonly opened: ReadonlySet<string>;
  readonly toggle: (turn: string) => void;
  /** Asks the core once for a turn's summary; a failure leaves it to be asked again. */
  readonly load: (turn: string, window: TurnWindow) => void;
}

type Summarize = (window: TurnWindow) => Promise<TurnSummary | null>;
type TurnSummariesStore = StoreApi<TurnSummariesState>;

/** A store for one conversation's turn summaries, with `ready` summaries known at first. */
export function createTurnSummariesStore(
  summarize: Summarize,
  ready: Readonly<Record<string, TurnSummary | null>> = {},
  opened: Iterable<string> = [],
): TurnSummariesStore {
  return createStore<TurnSummariesState>()((set, get) => ({
    entries: Object.fromEntries(
      Object.entries(ready).map(([turn, summary]) => [turn, { state: "ready", summary }] as const),
    ),
    opened: new Set(opened),
    toggle: (turn) =>
      set((state) => {
        const opened = new Set(state.opened);
        if (!opened.delete(turn)) opened.add(turn);
        return { opened };
      }),
    load: (turn, window) => {
      if (get().entries[turn] !== undefined) return;
      set((state) => ({ entries: { ...state.entries, [turn]: { state: "loading" } } }));
      summarize(window).then(
        (summary) =>
          set((state) => ({ entries: { ...state.entries, [turn]: { state: "ready", summary } } })),
        () =>
          set((state) => {
            const entries = { ...state.entries };
            delete entries[turn];
            return { entries };
          }),
      );
    },
  }));
}

const TurnSummariesContext = createContext<TurnSummariesStore | null>(null);

/**
 * Keeps the turn summaries of the conversation `conversation` names, which `summarize` asks the
 * core for (Lervo ADE sessions, "The turn summary"). Without `summarize`, as with a core that keeps
 * no turn records, no summary shows. The pane stays mounted when its conversation changes, so the
 * store is replaced during render.
 */
export function TurnSummariesProvider(
  props: PropsWithChildren<{
    conversation: object;
    summarize: Summarize | undefined;
    ready?: Readonly<Record<string, TurnSummary | null>>;
    opened?: Iterable<string>;
  }>,
) {
  const make = () =>
    props.summarize === undefined
      ? null
      : createTurnSummariesStore(props.summarize, props.ready, props.opened);
  const [state, setState] = useState(() => ({
    conversation: props.conversation,
    summarize: props.summarize,
    store: make(),
  }));
  if (state.conversation !== props.conversation || state.summarize !== props.summarize)
    setState({ conversation: props.conversation, summarize: props.summarize, store: make() });
  return (
    <TurnSummariesContext.Provider value={state.store}>
      {props.children}
    </TurnSummariesContext.Provider>
  );
}

/** Whether this conversation shows turn summaries. */
export function useShowsTurnSummaries(): boolean {
  return useContext(TurnSummariesContext) !== null;
}

/** A turn's summary entry, whether its card is open, and how to load it and open it. */
export function useTurnSummary(turn: string) {
  const store = useContext(TurnSummariesContext);
  if (store === null) throw new Error("A turn summary renders inside TurnSummariesProvider.");
  const entry = useStore(store, (state) => state.entries[turn]);
  const opened = useStore(store, (state) => state.opened.has(turn));
  const load = useStore(store, (state) => state.load);
  const toggle = useStore(store, (state) => state.toggle);
  return {
    entry,
    opened,
    load: (window: TurnWindow) => load(turn, window),
    toggle: () => toggle(turn),
  };
}
