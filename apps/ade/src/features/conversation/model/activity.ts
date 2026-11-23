import type { ConversationWindow } from "./window";

/** What the agent is doing at the live end, for the working line. */
export type Activity =
  | { readonly kind: "writing" }
  | { readonly kind: "tool"; readonly name: string }
  | { readonly kind: "thinking" };

/**
 * The agent's current activity, from the newest item: a reply that streams, a tool that runs, or
 * neither, while the agent thinks between them.
 */
export function activityOf(window: ConversationWindow): Activity {
  const last = window.items.at(-1);
  if (last?.kind === "agent_message" && last.state === "streaming") return { kind: "writing" };
  if (last?.kind === "tool_activity" && last.tool.status === "running")
    return { kind: "tool", name: last.tool.name };
  return { kind: "thinking" };
}
