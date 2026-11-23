import { isMac } from "../environment";

/** Whether the command modifier is Command, for the catalog's shortcut labels. */
export const commandModifier: "command" | "control" = isMac ? "command" : "control";

/** Whether `event` is the command modifier with `key` and no other modifier. */
export function isCommandKey(event: KeyboardEvent, key: string): boolean {
  const command = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return command && !event.altKey && !event.shiftKey && event.key.toLowerCase() === key;
}
