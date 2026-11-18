import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Private files of owner-turn capture (ADR-0467): 0600 records in 0700 directories under the
 * repository root, written atomically and read within a size bound. A symbolic link or other
 * non-directory on the path fails instead of being followed.
 */
export const INSTRUCTION_CAPTURE_ROOT = ".lervo/state/knowledge/instruction-capture";
const MAXIMUM_RECORD_BYTES = 64 * 1024;

/** Keeps the tail of a UTF-8 string within a byte bound without splitting a code point. */
export function boundedUtf8Tail(value: string, maximumBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maximumBytes) return value;
  let start = bytes.byteLength - maximumBytes;
  while (start < bytes.byteLength && ((bytes[start] ?? 0) & 0xc0) === 0x80) start += 1;
  return bytes.subarray(start).toString("utf8");
}

async function ensureDirectory(root: string, relative: string): Promise<string> {
  let directory = resolve(root);
  for (const part of relative.split("/")) {
    directory = resolve(directory, part);
    await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const observed = await lstat(directory);
    if (!observed.isDirectory() || observed.isSymbolicLink())
      throw new Error("The instruction capture state directory is invalid.");
  }
  return directory;
}

export async function writePrivate(root: string, directory: string, name: string, value: unknown) {
  const base = await ensureDirectory(root, directory);
  const temporary = resolve(base, `.capture-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, resolve(base, name));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function readPrivate(path: string): Promise<unknown> {
  try {
    const observed = await lstat(path);
    if (!observed.isFile() || observed.size > MAXIMUM_RECORD_BYTES) return null;
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}
