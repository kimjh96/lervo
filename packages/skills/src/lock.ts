import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { validateSchema, type SkillLock } from "@roven/schemas";

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
    .sort(([left], [right]) => left === right ? 0 : left < right ? -1 : 1)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function assertLock(lock: SkillLock): void {
  if (!validateSchema("skillLock", lock).valid) {
    throw new SkillResolutionError(
      "invalid_skill_lock",
      "생성한 skills.lock이 schema 계약을 통과하지 못했습니다.",
    );
  }
  if (new Set(lock.entries.map((entry) => entry.skillId)).size !== lock.entries.length) {
    throw new SkillResolutionError("invalid_skill_lock", "skills.lock에 중복된 skillId가 있습니다.");
  }
}

async function readExistingLock(path: string): Promise<string> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_LOCK_BYTES) {
    throw new SkillResolutionError(
      "invalid_skill_lock",
      "기존 skills.lock은 크기 제한 안의 일반 파일이어야 합니다.",
    );
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (before.dev !== opened.dev || before.ino !== opened.ino) {
      throw new SkillResolutionError(
        "invalid_skill_lock",
        "읽기 전에 기존 skills.lock 경로가 바뀌었습니다.",
      );
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      !after.isFile() ||
      after.size > MAX_LOCK_BYTES ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) {
      throw new SkillResolutionError(
        "invalid_skill_lock",
        "읽는 동안 기존 skills.lock이 바뀌었습니다.",
      );
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    await handle.close();
  }
}

export async function writeSkillLock(path: string, next: SkillLock): Promise<SkillLock> {
  assertLock(next);
  let current: SkillLock | undefined;
  try {
    const parsed: unknown = JSON.parse(await readExistingLock(path));
    if (!validateSchema("skillLock", parsed).valid) {
      throw new SkillResolutionError(
        "invalid_skill_lock",
        "기존 skills.lock이 schema 계약을 통과하지 못해 덮어쓰지 않았습니다.",
      );
    }
    current = parsed as SkillLock;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      if (error instanceof SkillResolutionError) throw error;
      throw new SkillResolutionError(
        "invalid_skill_lock",
        "기존 skills.lock을 안전하게 읽지 못해 덮어쓰지 않았습니다.",
        { cause: error },
      );
    }
  }
  if (current !== undefined && stableLock(current) === stableLock(next)) return current;
  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_LOCK_BYTES) {
    throw new SkillResolutionError(
      "invalid_skill_lock",
      "생성한 skills.lock이 크기 제한을 초과했습니다.",
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
      "skills.lock을 원자적으로 기록하지 못했습니다.",
      { cause: error },
    );
  }
  return structuredClone(next);
}
