import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";

export interface TranscriptPosition {
  path: string;
  offset: number;
  device: string;
  inode: string;
  prefixBytes: number;
  prefixDigest: string;
}

export function validTranscriptPosition(value: unknown): value is TranscriptPosition {
  const item = value as TranscriptPosition | null;
  return (
    item !== null &&
    typeof item === "object" &&
    typeof item.path === "string" &&
    isAbsolute(item.path) &&
    item.path.length <= 4096 &&
    !item.path.includes("\0") &&
    Number.isSafeInteger(item.offset) &&
    item.offset >= 0 &&
    typeof item.device === "string" &&
    /^\d+$/u.test(item.device) &&
    typeof item.inode === "string" &&
    /^\d+$/u.test(item.inode) &&
    item.prefixBytes === Math.min(item.offset, 4096) &&
    typeof item.prefixDigest === "string" &&
    /^sha256:[a-f0-9]{64}$/u.test(item.prefixDigest)
  );
}

function within(root: string, path: string): boolean {
  const part = relative(root, path);
  return part !== "" && !isAbsolute(part) && part !== ".." && !part.startsWith("../");
}

/**
 * The configuration directory the person chose for the provider, as its CLI reads it:
 * `CLAUDE_CONFIG_DIR` for Claude Code and `CODEX_HOME` for Codex. Undefined for the default.
 */
function configuredHome(provider: "claude" | "codex"): string | undefined {
  const chosen = provider === "claude" ? process.env.CLAUDE_CONFIG_DIR : process.env.CODEX_HOME;
  return chosen === undefined || chosen === "" ? undefined : resolve(chosen);
}

/** Where the provider keeps its transcripts under `home`, or under its chosen directory. */
function providerTranscriptBase(provider: "claude" | "codex", home: string): string {
  const configured = configuredHome(provider) ?? resolve(home, `.${provider}`);
  return resolve(configured, provider === "claude" ? "projects" : "sessions");
}

/** Both ingress and the resident enforce the provider's own host-local transcript boundary. */
export async function openProviderTranscript(
  provider: "claude" | "codex",
  path: string,
): Promise<FileHandle> {
  if (!isAbsolute(path) || path.length > 4096 || path.includes("\0"))
    throw new Error("Invalid transcript path.");
  const logicalBase = providerTranscriptBase(provider, homedir());
  // The default directory must really lie in the home; a directory the person chose is trusted
  // where it really is.
  const base =
    configuredHome(provider) === undefined
      ? providerTranscriptBase(provider, await realpath(homedir()))
      : await realpath(logicalBase);
  const actual = await realpath(path);
  if (
    (!within(logicalBase, resolve(path)) && !within(base, resolve(path))) ||
    !within(base, actual) ||
    (await realpath(logicalBase)) !== base
  )
    throw new Error("Transcript escaped its provider directory.");
  const handle = await open(
    actual,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  const metadata = await handle.stat();
  if (!metadata.isFile() || metadata.uid !== process.getuid?.()) {
    await handle.close();
    throw new Error("Transcript is not owned by this user.");
  }
  return handle;
}

export async function transcriptPrefixDigest(handle: FileHandle, length: number): Promise<string> {
  const bytes = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const result = await handle.read(bytes, read, length - read, read);
    if (result.bytesRead === 0) throw new Error("Transcript prefix shrank.");
    read += result.bytesRead;
  }
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** Hook ingress hashes at most 4 KiB. It never parses transcript content. */
export async function terminalTranscriptPosition(
  provider: "claude" | "codex",
  path?: string,
): Promise<TranscriptPosition | null> {
  if (!path) return null;
  try {
    const handle = await openProviderTranscript(provider, path);
    try {
      const metadata = await handle.stat({ bigint: true });
      const offset = Number(metadata.size);
      if (!Number.isSafeInteger(offset)) return null;
      const prefixBytes = Math.min(offset, 4096);
      return {
        path: await realpath(path),
        offset,
        device: String(metadata.dev),
        inode: String(metadata.ino),
        prefixBytes,
        prefixDigest: await transcriptPrefixDigest(handle, prefixBytes),
      };
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/**
 * A provider can create a session's transcript only after its first prompt hook. The hook then
 * records the absent path, so Stop can read that turn from the start of the new file.
 */
export async function absentTerminalTranscript(
  provider: "claude" | "codex",
  path?: string,
): Promise<string | null> {
  if (!path || !isAbsolute(path) || path.length > 4096 || path.includes("\0")) return null;
  const logical = resolve(path);
  if (!within(providerTranscriptBase(provider, homedir()), logical)) return null;
  try {
    await lstat(logical);
    return null;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? logical : null;
  }
}

/** Everything in a transcript created during the turn belongs to that turn. */
export function newTranscriptStart(end: TranscriptPosition): TranscriptPosition {
  return {
    ...end,
    offset: 0,
    prefixBytes: 0,
    prefixDigest: `sha256:${createHash("sha256").update(Buffer.alloc(0)).digest("hex")}`,
  };
}
