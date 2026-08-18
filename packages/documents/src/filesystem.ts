import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";

import { DocumentMigrationError } from "./types.js";

interface FileIdentity {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}

function identity(stats: FileIdentity): FileIdentity {
  return {
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mtimeNs: stats.mtimeNs,
    ctimeNs: stats.ctimeNs,
  };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

export function normalizeScanPath(path: string): string {
  if (
    path.length === 0 || path.includes("\0") || path.includes("\\") ||
    isAbsolute(path) || /^[A-Za-z]:[\\/]/.test(path)
  ) {
    throw new DocumentMigrationError(
      "invalid_scan_request",
      "탐색 경로는 저장소 안의 정규화된 상대 경로여야 합니다.",
    );
  }
  const normalized = posix.normalize(path);
  if (normalized === ".." || normalized.startsWith("../") || normalized !== path) {
    throw new DocumentMigrationError(
      "invalid_scan_request",
      "탐색 경로는 저장소 밖으로 나가거나 정규화 전 표현을 사용할 수 없습니다.",
    );
  }
  return normalized;
}

export async function canonicalRepositoryRoot(root: string): Promise<string> {
  const absolute = resolve(root);
  try {
    const stats = await lstat(absolute);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new DocumentMigrationError(
        "unsafe_source",
        "저장소 root는 symbolic link가 아닌 실제 디렉터리여야 합니다.",
      );
    }
    return await realpath(absolute);
  } catch (error) {
    if (error instanceof DocumentMigrationError) throw error;
    throw new DocumentMigrationError(
      "unsafe_source",
      "저장소 root를 안전하게 확인할 수 없습니다.",
      { cause: error },
    );
  }
}

export function absoluteRepositoryPath(root: string, path: string): string {
  const absolute = resolve(root, ...normalizeScanPath(path).split("/"));
  const child = relative(root, absolute);
  if (child === ".." || child.startsWith(`..${sep}`)) {
    throw new DocumentMigrationError(
      "invalid_scan_request",
      "탐색 경로가 저장소 밖을 가리킵니다.",
    );
  }
  return absolute;
}

export async function readStableFile(
  root: string,
  path: string,
  maximumBytes: number,
): Promise<Uint8Array> {
  const normalized = normalizeScanPath(path);
  const absolute = absoluteRepositoryPath(root, normalized);
  let handle;
  try {
    const pathStats = await lstat(absolute, { bigint: true });
    if (pathStats.isSymbolicLink() || !pathStats.isFile()) {
      throw new DocumentMigrationError(
        "unsafe_source",
        `문서 source는 일반 파일이어야 합니다: ${normalized}`,
      );
    }
    if (pathStats.size > BigInt(maximumBytes)) {
      throw new DocumentMigrationError(
        "scan_limit_exceeded",
        `문서 source가 개별 파일 크기 제한을 넘었습니다: ${normalized}`,
      );
    }
    handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = identity(await handle.stat({ bigint: true }));
    if (!sameIdentity(identity(pathStats), before)) {
      throw new DocumentMigrationError(
        "unsafe_source",
        `문서 source 경로가 읽기 전에 바뀌었습니다: ${normalized}`,
      );
    }
    const bytes = await handle.readFile();
    const after = identity(await handle.stat({ bigint: true }));
    const finalPathStats = await lstat(absolute, { bigint: true });
    if (
      !sameIdentity(before, after) || !sameIdentity(after, identity(finalPathStats)) ||
      finalPathStats.isSymbolicLink() || await realpath(absolute) !== absolute
    ) {
      throw new DocumentMigrationError(
        "unsafe_source",
        `문서 source가 읽는 동안 바뀌었습니다: ${normalized}`,
      );
    }
    return bytes;
  } catch (error) {
    if (error instanceof DocumentMigrationError) throw error;
    throw new DocumentMigrationError(
      "unsafe_source",
      `문서 source를 안전하게 읽을 수 없습니다: ${normalized}`,
      { cause: error },
    );
  } finally {
    await handle?.close();
  }
}

export async function inspectTargetFile(
  root: string,
  path: string,
  maximumBytes: number,
): Promise<
  | { kind: "missing" }
  | { kind: "file"; bytes: Uint8Array }
  | { kind: "unsafe"; reasonCode: string }
> {
  const normalized = normalizeScanPath(path);
  const segments = normalized.split("/");
  for (const [index, segment] of segments.entries()) {
    const current = resolve(root, ...segments.slice(0, index + 1));
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) return { kind: "unsafe", reasonCode: "target_unsafe" };
      const final = index === segments.length - 1;
      if (final ? !stats.isFile() : !stats.isDirectory()) {
        return { kind: "unsafe", reasonCode: "target_unsafe" };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
      return { kind: "unsafe", reasonCode: "target_unreadable" };
    }
  }
  try {
    return { kind: "file", bytes: await readStableFile(root, normalized, maximumBytes) };
  } catch {
    return { kind: "unsafe", reasonCode: "target_unsafe" };
  }
}
