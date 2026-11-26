/** Files one message carries, by path. */
export const MAX_ATTACHED_FILES = 10;

/**
 * The line that starts the list of attached paths at the end of a message's text (Lervo ADE
 * sessions, "Files in a message"). The agent reads the paths with its own tools; the bubble shows
 * them as files.
 */
const FILES_HEADING = "Attached files:";

/** Extensions of files attached as images: formats the webview draws and so can prepare. */
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "heic",
  "heif",
  "bmp",
  "tif",
  "tiff",
]);

/** A path's last part: a file's name or a folder's. */
export function baseName(path: string): string {
  const parts = path.split("/").filter((part) => part.length > 0);
  return parts.at(-1) ?? path;
}

/** The name of the folder a path is in, such as `Downloads`; empty at the root. */
export function folderName(path: string): string {
  const parts = path.split("/").filter((part) => part.length > 0);
  return parts.at(-2) ?? "";
}

/** A file name's extension in lowercase, without the dot; empty when it has none. */
export function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 || dot === name.length - 1 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Whether a path names an image the card prepares and sends as an image, not as a path. */
export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extension(baseName(path)));
}

/** Whether a path can travel in a message's list: absolute, on one line. */
export function isAttachablePath(path: string): boolean {
  return path.startsWith("/") && !/[\r\n]/.test(path);
}

/** A message's text with its attached paths listed at the end, as the agent receives it. */
export function withAttachedFiles(text: string, paths: readonly string[]): string {
  if (paths.length === 0) return text;
  const list = [FILES_HEADING, ...paths.map((path) => `- ${path}`)].join("\n");
  return text.length === 0 ? list : `${text}\n\n${list}`;
}

const LISTED = /(?:^|\n\n)Attached files:\n((?:- \/[^\n]*(?:\n|$))+)$/;

/**
 * A message's text and the paths listed at its end by `withAttachedFiles`; text without the list
 * comes back whole.
 */
export function attachedFiles(text: string): { text: string; paths: string[] } {
  const match = LISTED.exec(text);
  if (match?.[1] === undefined) return { text, paths: [] };
  const paths = match[1]
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.slice(2));
  return { text: text.slice(0, match.index), paths };
}

/** The units a file's size shows in, smallest first. */
export type SizeUnit = "B" | "KB" | "MB" | "GB" | "TB";

/**
 * A file's size as the chip shows it: the value in the largest unit under 1000, with one decimal
 * below 10, such as 84 KB or 1.2 MB. The view formats the number for the locale.
 */
export function fileSize(bytes: number): { value: number; unit: SizeUnit; decimals: number } {
  if (bytes < 1000) return { value: bytes, unit: "B", decimals: 0 };
  const units: SizeUnit[] = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return { value, unit: units[unit] ?? "TB", decimals: value < 10 ? 1 : 0 };
}
