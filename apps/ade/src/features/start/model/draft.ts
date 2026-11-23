import type { Drafts } from "../../../ports";
import { useStartStore } from "./store";

const KEY = "start";

/**
 * Keeps the start screen's instruction as a draft across reloads and restarts (ADE quality, "No
 * user input is lost"): it restores the stored instruction, then stores each change. Returns the
 * unsubscribe function.
 */
export function bindStartDraft(drafts: Drafts): () => void {
  const stored = drafts.read(KEY);
  if (stored.length > 0 && useStartStore.getState().draft.instruction.length === 0)
    useStartStore.setState((store) => ({ draft: { ...store.draft, instruction: stored } }));
  return useStartStore.subscribe((state, previous) => {
    if (state.draft.instruction !== previous.draft.instruction)
      drafts.write(KEY, state.draft.instruction);
  });
}
