/** The platform's command modifier: Command on macOS, Control elsewhere. */
const mac = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac OS");

/** How a shortcut with the command modifier reads, such as "⌘N" or "Ctrl+N". */
export function shortcutLabel(key: string): string {
  return mac ? `⌘${key}` : `Ctrl+${key}`;
}

/** Whether `event` is the command modifier with `key` and no other modifier. */
export function isCommandKey(event: KeyboardEvent, key: string): boolean {
  const command = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return command && !event.altKey && !event.shiftKey && event.key.toLowerCase() === key;
}
