import { createContext, type PropsWithChildren, useContext, useState } from "react";
import { createStore, type StoreApi, useStore } from "zustand";

/** Which tool lines of one conversation the user opened. It is view state, not conversation data. */
interface ToolLinesState {
  readonly opened: ReadonlySet<string>;
  /** How many times the user opened or closed a line, so the list can keep it in place. */
  readonly toggles: number;
  readonly toggle: (itemId: string) => void;
}

type ToolLinesStore = StoreApi<ToolLinesState>;

/** A store for one conversation's tool lines, with `opened` open at first. */
export function createToolLinesStore(opened: Iterable<string> = []): ToolLinesStore {
  return createStore<ToolLinesState>()((set) => ({
    opened: new Set(opened),
    toggles: 0,
    toggle: (itemId) =>
      set((state) => {
        const next = new Set(state.opened);
        if (!next.delete(itemId)) next.add(itemId);
        return { opened: next, toggles: state.toggles + 1 };
      }),
  }));
}

const ToolLinesContext = createContext<ToolLinesStore | null>(null);

/**
 * Keeps the open tool lines of the conversation `conversation` names. They stay open while their
 * rows leave and return to view, and a different conversation starts with every line closed. The
 * pane stays mounted when its conversation changes, so the store is replaced during render
 * instead of remounting the list.
 */
export function ToolLinesProvider(
  props: PropsWithChildren<{ conversation: object; opened?: Iterable<string> }>,
) {
  const [state, setState] = useState(() => ({
    conversation: props.conversation,
    store: createToolLinesStore(props.opened),
  }));
  if (state.conversation !== props.conversation)
    setState({ conversation: props.conversation, store: createToolLinesStore() });
  return (
    <ToolLinesContext.Provider value={state.store}>{props.children}</ToolLinesContext.Provider>
  );
}

function useToolLinesStore(): ToolLinesStore {
  const store = useContext(ToolLinesContext);
  if (store === null) throw new Error("Tool lines render inside ToolLinesProvider.");
  return store;
}

/** How many times the user opened or closed a tool line of this conversation. */
export function useToolLineToggles(): number {
  return useStore(useToolLinesStore(), (state) => state.toggles);
}

/** Whether the tool line `itemId` is open, and how to open or close it. */
export function useToolLine(itemId: string): readonly [opened: boolean, toggle: () => void] {
  const store = useToolLinesStore();
  const opened = useStore(store, (state) => state.opened.has(itemId));
  const toggle = useStore(store, (state) => state.toggle);
  return [opened, () => toggle(itemId)];
}
