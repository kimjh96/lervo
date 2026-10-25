import { assertRealRuntimeRoot } from "./node-runtime-root-guard.js";
import { lstat, open, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

const JOURNAL = ".retention-journal.json";
const TOMBSTONE = /^\.retired-[a-f0-9]{16}-[a-f0-9-]{36}$/u;

/** One interrupted detach is resumed before another retirement starts, under the runtime lock. */
export async function recoverRuntimeRetirement(root: string): Promise<void> {
  const path = resolve(root, JOURNAL);
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (info === null) return;
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024)
    throw new Error("Unsafe runtime retirement journal.");
  await assertRealRuntimeRoot(root);
  const journal = JSON.parse(await readFile(path, "utf8")) as {
    schemaVersion?: number;
    name?: string;
    tombstone?: string;
  };
  if (
    journal.schemaVersion !== 1 ||
    typeof journal.name !== "string" ||
    !/^[a-f0-9]{16}$/u.test(journal.name) ||
    typeof journal.tombstone !== "string" ||
    !TOMBSTONE.test(journal.tombstone) ||
    !journal.tombstone.startsWith(`.retired-${journal.name}-`)
  )
    throw new Error("Invalid runtime retirement journal.");
  const tombstone = resolve(root, journal.tombstone);
  const detached = await lstat(tombstone).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (detached !== null) {
    if (!detached.isDirectory() || detached.isSymbolicLink())
      throw new Error("Unsafe runtime retirement tombstone.");
    if (await lstat(resolve(root, journal.name)).catch(() => null))
      throw new Error("A detached runtime was recreated.");
    await rm(tombstone, { recursive: true, force: true });
  }
  await rm(path);
}

export async function journalRuntimeRetirement(
  root: string,
  name: string,
  tombstone: string,
): Promise<void> {
  if (!/^[a-f0-9]{16}$/u.test(name) || !TOMBSTONE.test(tombstone))
    throw new Error("Invalid runtime retirement coordinate.");
  const file = await open(resolve(root, JOURNAL), "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify({ schemaVersion: 1, name, tombstone }));
    await file.sync();
  } finally {
    await file.close();
  }
  const directory = await open(root, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function hasRuntimeRetirementJournal(root: string): Promise<boolean> {
  return (
    (await lstat(resolve(root, JOURNAL)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    })) !== null
  );
}
