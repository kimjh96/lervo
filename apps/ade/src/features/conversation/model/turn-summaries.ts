// One conversation's turn summaries, read from the core (Lervo ADE sessions, "The turn summary").
import type { TurnSummary } from "@lervo/session-host-contract";
import { createStore, type StoreApi } from "zustand";

import { type ApplicationCommands, failureCode } from "../../../ports";
import type { TurnWindow } from "./turns";

/**
 * What the core recorded about one turn, once asked: its summary, null when it has none, or the
 * code of a failure. A failed turn is not asked again until the conversation reopens, so a core
 * that keeps failing is not asked on every render.
 */
export type TurnSummaryEntry =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly summary: TurnSummary | null }
  | { readonly state: "failed"; readonly code: string };

export interface TurnSummariesState {
  readonly entries: Readonly<Record<string, TurnSummaryEntry>>;
  /** Turns whose summary card the user opened. */
  readonly opened: ReadonlySet<string>;
  readonly toggle: (turn: string) => void;
  /** Asks the core once for a turn's summary. */
  readonly load: (turn: string, window: TurnWindow) => void;
}

/** Reads one turn's summary from the core. */
export type Summarize = (window: TurnWindow) => Promise<TurnSummary | null>;
export type TurnSummariesStore = StoreApi<TurnSummariesState>;

/** Reads a workspace's turn summaries through the core's `turn.summary`. */
export function turnSummarizer(commands: ApplicationCommands, workspaceId: string): Summarize {
  return async (window) => {
    const result = await commands.run("turn.summary", { workspaceId, turns: [window] });
    return result.turns[0] ?? null;
  };
}

/** A store for one conversation's turn summaries, with `ready` summaries known at first. */
export function createTurnSummariesStore(
  summarize: Summarize,
  ready: Readonly<Record<string, TurnSummary | null>> = {},
  opened: Iterable<string> = [],
): TurnSummariesStore {
  return createStore<TurnSummariesState>()((set, get) => {
    const settle = (turn: string, entry: TurnSummaryEntry) =>
      set((state) => ({ entries: { ...state.entries, [turn]: entry } }));
    return {
      entries: Object.fromEntries(
        Object.entries(ready).map(
          ([turn, summary]) => [turn, { state: "ready", summary }] as const,
        ),
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
        settle(turn, { state: "loading" });
        summarize(window).then(
          (summary) => settle(turn, { state: "ready", summary }),
          (failure: unknown) => settle(turn, { state: "failed", code: failureCode(failure) }),
        );
      },
    };
  });
}
