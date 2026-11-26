import { type ComponentProps, lazy, Suspense } from "react";

import type { WorkspaceConversation as Conversation } from "./WorkspaceConversation";

// The conversation loads as one chunk, so the start screen's bundle carries none of it (ADE
// performance, bundle budget). The frame loads it right after the first paint, so opening a
// workspace never waits for it.
const load = () => import("./WorkspaceConversation");
const Loaded = lazy(() => load().then((module) => ({ default: module.WorkspaceConversation })));

/** Loads the conversation's chunk ahead of the first workspace. */
export function preloadConversation(): void {
  void load();
}

/** One workspace's native conversation, from its chunk. */
export function WorkspaceConversation(props: ComponentProps<typeof Conversation>) {
  return (
    <Suspense fallback={null}>
      <Loaded {...props} />
    </Suspense>
  );
}
