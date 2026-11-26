import type { TurnSummary } from "@lervo/session-host-contract";
import { createContext, type PropsWithChildren, useCallback, useContext, useState } from "react";
import { useStore } from "zustand";

import {
  createTurnSummariesStore,
  type Summarize,
  type TurnSummariesStore,
} from "../model/turn-summaries";
import type { TurnWindow } from "../model/turns";

export type { TurnWindow };

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
    // Stable while the turn and store are, so the line asks the core once per turn.
    load: useCallback((window: TurnWindow) => load(turn, window), [load, turn]),
    toggle: () => toggle(turn),
  };
}
