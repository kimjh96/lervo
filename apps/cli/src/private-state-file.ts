import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

const DIRECTORY = ".lervo/state";

/** Reads one bounded private state file; missing, oversized, or unparsable state is null. */
export async function readPrivateStateJson(
  root: string,
  file: string,
  maximumBytes: number,
): Promise<unknown> {
  try {
    const path = resolve(root, DIRECTORY, file);
    const stats = await lstat(path);
    if (!stats.isFile() || stats.size > maximumBytes) return null;
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/** Replaces one private state file atomically with mode 0600, refusing a linked directory. */
export async function writePrivateStateJson(
  root: string,
  file: string,
  value: unknown,
): Promise<void> {
  const directory = resolve(root, DIRECTORY);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink())
    throw new Error("Unsafe Lervo state directory.");
  const temporary = resolve(directory, `.${file}-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(`${JSON.stringify(value)}\n`);
    await handle.close();
    handle = undefined;
    await rename(temporary, resolve(directory, file));
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}
