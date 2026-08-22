import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { IdentityMigrationError } from "./types.js";

const PREFIX_PATTERN = /^[a-f0-9]{2}$/;
const SUFFIX_PATTERN = /^[a-f0-9]{62}$/;

async function entryKind(path: string): Promise<"missing" | "directory" | "file" | "unsafe"> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) return "unsafe";
    if (stats.isDirectory()) return "directory";
    if (stats.isFile()) return "file";
    return "unsafe";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { flags: "r" })) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function inspectLegacyCas(root: string): Promise<number> {
  const kind = await entryKind(root);
  if (kind === "missing") return 0;
  if (kind !== "directory") {
    throw new IdentityMigrationError("migration_blocked", "이전 CAS 경로가 실제 디렉터리가 아닙니다.");
  }
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!["sha256", ".tmp"].includes(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) {
      throw new IdentityMigrationError("migration_blocked", "이전 CAS에 계약 밖의 항목이 있습니다.");
    }
  }
  const temporaryRoot = resolve(root, ".tmp");
  if (await entryKind(temporaryRoot) === "directory" && (await readdir(temporaryRoot)).length > 0) {
    throw new IdentityMigrationError(
      "migration_blocked",
      "이전 CAS 임시 파일이 남아 있습니다. 실행 중인 작업을 종료하고 상태를 확인하세요.",
    );
  }
  const objectsRoot = resolve(root, "sha256");
  if (await entryKind(objectsRoot) === "missing") return 0;
  if (await entryKind(objectsRoot) !== "directory") {
    throw new IdentityMigrationError("migration_blocked", "이전 CAS object 경로가 안전하지 않습니다.");
  }
  let count = 0;
  const prefixes = await readdir(objectsRoot, { withFileTypes: true });
  for (const prefix of prefixes) {
    if (!PREFIX_PATTERN.test(prefix.name) || !prefix.isDirectory() || prefix.isSymbolicLink()) {
      throw new IdentityMigrationError("migration_blocked", "이전 CAS object prefix가 계약과 다릅니다.");
    }
    const prefixRoot = resolve(objectsRoot, prefix.name);
    const objects = await readdir(prefixRoot, { withFileTypes: true });
    for (const object of objects) {
      if (!SUFFIX_PATTERN.test(object.name) || !object.isFile() || object.isSymbolicLink()) {
        throw new IdentityMigrationError("migration_blocked", "이전 CAS object 경로가 계약과 다릅니다.");
      }
      const expected = `${prefix.name}${object.name}`;
      if (await hashFile(resolve(prefixRoot, object.name)) !== expected) {
        throw new IdentityMigrationError("migration_blocked", "이전 CAS object의 content hash가 다릅니다.");
      }
      count += 1;
      if (count > 100_000) {
        throw new IdentityMigrationError("migration_blocked", "이전 CAS object 수가 검사 한도를 넘습니다.");
      }
    }
  }
  return count;
}
