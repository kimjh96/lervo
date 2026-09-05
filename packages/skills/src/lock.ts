import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { validateSchema, type SkillLock } from "@lervo/schemas";

import {
  sameFileAcrossStatSurfaces,
  sameFileWithinStatSurface,
} from "./stable-file-observation.js";
import { SkillResolutionError } from "./types.js";

const MAX_LOCK_BYTES = 4 * 1024 * 1024;

function stableLock(lock: SkillLock): string {
  const { generatedAt: _generatedAt, ...stable } = lock;
  return canonicalJson(stable);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function assertLock(lock: SkillLock): void {
  if (!validateSchema("skillLock", lock).valid) {
    throw new SkillResolutionError(
      "invalid_skill_lock",
      "The generated skills.lock does not satisfy its schema contract.",
    );
  }
  if (new Set(lock.entries.map((entry) => entry.skillId)).size !== lock.entries.length) {
    throw new SkillResolutionError(
      "invalid_skill_lock",
      "skills.lock contains a duplicate skillId.",
    );
  }
}

export async function readSkillLock(path: string): Promise<SkillLock | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readExistingLock(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof SkillResolutionError) throw error;
    throw new SkillResolutionError(
      "invalid_skill_lock",
      "The existing skills.lock could not be read safely.",
      { cause: error },
    );
  }
  if (!validateSchema("skillLock", parsed).valid) {
    throw new SkillResolutionError(
      "invalid_skill_lock",
      "The existing skills.lock does not satisfy its schema contract.",
    );
  }
  const lock = parsed as SkillLock;
  assertLock(lock);
  return structuredClone(lock);
}

async function readExistingLock(path: string): Promise<string> {
  const beforePath = await lstat(path);
  if (!beforePath.isFile() || beforePath.isSymbolicLink() || beforePath.size > MAX_LOCK_BYTES) {
    throw new SkillResolutionError(
      "invalid_skill_lock",
      "The existing skills.lock must be a regular file within the size limit.",
    );
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const openedHandle = await handle.stat();
    const afterOpenPath = await lstat(path);
    if (
      !openedHandle.isFile() ||
      openedHandle.size > MAX_LOCK_BYTES ||
      !afterOpenPath.isFile() ||
      afterOpenPath.isSymbolicLink() ||
      afterOpenPath.size > MAX_LOCK_BYTES ||
      !sameFileWithinStatSurface(beforePath, afterOpenPath) ||
      !sameFileAcrossStatSurfaces(afterOpenPath, openedHandle)
    ) {
      throw new SkillResolutionError(
        "invalid_skill_lock",
        "The existing skills.lock path changed before it was read.",
      );
    }
    const bytes = await handle.readFile();
    const afterReadHandle = await handle.stat();
    const afterReadPath = await lstat(path);
    if (
      !afterReadHandle.isFile() ||
      afterReadHandle.size > MAX_LOCK_BYTES ||
      !afterReadPath.isFile() ||
      afterReadPath.isSymbolicLink() ||
      afterReadPath.size > MAX_LOCK_BYTES ||
      !sameFileWithinStatSurface(openedHandle, afterReadHandle) ||
      !sameFileWithinStatSurface(afterOpenPath, afterReadPath) ||
      !sameFileAcrossStatSurfaces(afterReadPath, afterReadHandle)
    ) {
      throw new SkillResolutionError(
        "invalid_skill_lock",
        "The existing skills.lock changed while it was being read.",
      );
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    await handle.close();
  }
}

export async function writeSkillLock(path: string, next: SkillLock): Promise<SkillLock> {
  assertLock(next);
  const current = await readSkillLock(path);
  if (current !== null && stableLock(current) === stableLock(next)) return current;
  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_LOCK_BYTES) {
    throw new SkillResolutionError(
      "invalid_skill_lock",
      "The generated skills.lock exceeds the size limit.",
    );
  }
  const temporary = resolve(dirname(path), `.skills.lock.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, serialized, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch {}
    throw new SkillResolutionError(
      "skill_lock_write_failed",
      "skills.lock could not be written atomically.",
      { cause: error },
    );
  }
  return structuredClone(next);
}
