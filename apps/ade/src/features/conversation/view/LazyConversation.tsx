import { type ComponentProps, useEffect, useState } from "react";

import type { WorkspaceConversation as Conversation } from "./WorkspaceConversation";

type ConversationView = typeof Conversation;

// The conversation loads as one chunk, so the start screen's bundle carries none of it (ADE
// performance, bundle budget). The frame loads it right after the first paint, so opening a
// workspace never waits for it.
let loaded: ConversationView | null = null;
let loading: Promise<ConversationView> | null = null;
const load = (): Promise<ConversationView> =>
  (loading ??= import("./WorkspaceConversation").then(
    (module) => (loaded = module.WorkspaceConversation),
  ));

/** Loads the conversation's chunk ahead of the first workspace. */
export function preloadConversation(): void {
  void load();
}

/**
 * One workspace's native conversation, from its chunk. A chunk the frame already loaded renders at
 * once. React.lazy would suspend on its first render even then, and React holds a revealed
 * Suspense boundary back for 300 ms, which delayed every first conversation by that much.
 */
export function WorkspaceConversation(props: ComponentProps<ConversationView>) {
  const [View, setView] = useState<ConversationView | null>(() => loaded);
  useEffect(() => {
    if (View === null) void load().then((view) => setView(() => view));
  }, [View]);
  // motion: History loads or a workspace reopens
  return View === null ? null : <View {...props} />;
}
