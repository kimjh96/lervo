import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * Owner-only JSON files for ADR-0469 continuity state. Writes are atomic (temporary file plus
 * rename) with mode 0600 inside 0700 directories; symbolic links are refused at every level the
 * writer creates.
 */
async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw Object.assign(new Error("A private state directory is invalid."), {
      code: "private_state_directory_invalid",
    });
}

export async function writePrivateJsonFile(path: string, value: unknown): Promise<void> {
  const target = resolve(path);
  const directory = dirname(target);
  await ensurePrivateDirectory(directory);
  const temporary = resolve(directory, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await chmod(temporary, 0o600);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** Creates the file only when absent; returns false when another writer created it first. */
export async function createPrivateJsonFile(path: string, value: unknown): Promise<boolean> {
  const target = resolve(path);
  await ensurePrivateDirectory(dirname(target));
  try {
    await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  await chmod(target, 0o600);
  return true;
}

/** `absent` for a missing file; `invalid` for a non-regular, oversized, or non-JSON file. */
export async function readPrivateJsonFile(
  path: string,
  maximumBytes: number,
): Promise<{ status: "absent" } | { status: "invalid" } | { status: "read"; value: unknown }> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > maximumBytes) return { status: "invalid" };
    return { status: "read", value: JSON.parse(await readFile(path, "utf8")) as unknown };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "absent" };
    return { status: "invalid" };
  }
}
