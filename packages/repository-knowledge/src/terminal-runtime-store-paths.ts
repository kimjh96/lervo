import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { isObject, safeOptionalText } from "./terminal-integration-files.js";

export interface TerminalRuntimePointer {
  schemaVersion: 1;
  directory: string;
  contentHash: string;
  publisher: string;
  predecessor: { directory: string; contentHash: string } | null;
  /**
   * What the named runtime can do, as its publisher declared it, such as
   * `conversation-workspace-v1`. A pointer an older publisher wrote names none, so a reader that
   * needs a capability treats that runtime as lacking it.
   */
  capabilities?: string[];
}

/** One declared runtime capability: a short lowercase name with a version suffix. */
const CAPABILITY = /^[a-z][a-z0-9-]{0,62}$/u;
/** The most capabilities a pointer declares. */
export const MAXIMUM_TERMINAL_RUNTIME_CAPABILITIES = 16;

/** Whether `value` is a valid capability list: bounded, unique, and each a capability name. */
export function validTerminalRuntimeCapabilities(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAXIMUM_TERMINAL_RUNTIME_CAPABILITIES &&
    new Set(value).size === value.length &&
    value.every((item) => typeof item === "string" && CAPABILITY.test(item))
  );
}

export function terminalHookRuntimeStorePath(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  return platform === "win32"
    ? resolve(environment.LOCALAPPDATA || resolve(home, "AppData/Local"), "Lervo/terminal-hooks")
    : resolve(home, ".lervo/terminal-hooks");
}

export async function readTerminalRuntimePointer(
  store: string,
): Promise<TerminalRuntimePointer | null> {
  const file = await safeOptionalText(resolve(store, "current.json"), 4096);
  if (file === null) return null;
  const value: unknown = JSON.parse(file.content);
  if (
    !isObject(value) ||
    value.schemaVersion !== 1 ||
    !validCoordinate(value) ||
    typeof value.publisher !== "string" ||
    !isAbsolute(value.publisher) ||
    (value.predecessor !== null && !validCoordinate(value.predecessor)) ||
    (value.capabilities !== undefined && !validTerminalRuntimeCapabilities(value.capabilities))
  )
    throw new Error("The host terminal runtime pointer is invalid.");
  return value as unknown as TerminalRuntimePointer;
}

function validCoordinate(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.contentHash === "string" &&
    /^sha256:[a-f0-9]{64}$/u.test(value.contentHash) &&
    typeof value.directory === "string" &&
    new RegExp(`^${value.contentHash.slice(7, 23)}(?:-repair-[a-f0-9]{16})?$`, "u").test(
      value.directory,
    )
  );
}

/** Whether a pointer's declared capabilities are exactly `capabilities`, in order. */
export function sameTerminalRuntimeCapabilities(
  declared: readonly string[] | undefined,
  capabilities: readonly string[],
): boolean {
  const current = declared ?? [];
  return (
    current.length === capabilities.length &&
    current.every((capability, index) => capability === capabilities[index])
  );
}

/**
 * Whether the host's current terminal hook runtime declares `capability`. It reads only the
 * pointer, at most 4 KiB, so a caller on a start path pays one small file read. A missing,
 * unreadable, or invalid pointer declares nothing.
 */
export async function hostTerminalRuntimeDeclares(
  store: string,
  capability: string,
): Promise<boolean> {
  try {
    return (await readTerminalRuntimePointer(store))?.capabilities?.includes(capability) === true;
  } catch {
    return false;
  }
}
