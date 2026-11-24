import type { Clipboard } from "../../ports/clipboard";

/** The clipboard through the webview, which allows a write during a click. */
export function webClipboard(): Clipboard {
  return { copy: (text) => navigator.clipboard.writeText(text) };
}
