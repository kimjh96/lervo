import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { isObject, safeOptionalText } from "./terminal-integration-files.js";

export interface TerminalRuntimePointer {
  schemaVersion: 1;
  directory: string;
  contentHash: string;
  publisher: string;
  predecessor: { directory: string; contentHash: string } | null;
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
    (value.predecessor !== null && !validCoordinate(value.predecessor))
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
