import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { posix, resolve } from "node:path";

import { canonicalJson } from "@lervo/event-contract";

const MAX_SOURCE_FILES = 100_000;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024 * 1024;

export interface SourceTreeSnapshot {
  readonly hash: string;
  readonly fileCount: number;
  readonly byteCount: number;
}

export class SourceTreeScanError extends Error {
  constructor(
    readonly code: "source_unsafe" | "source_changed" | "scan_limit_exceeded",
    message: string,
  ) {
    super(message);
    this.name = "SourceTreeScanError";
  }
}

function scanLimit(message: string): never {
  throw new SourceTreeScanError("scan_limit_exceeded", message);
}

export async function snapshotSourceTree(root: string): Promise<SourceTreeSnapshot> {
  const treeHash = createHash("sha256");
  let fileCount = 0;
  let byteCount = 0;

  async function visit(directory: string, relativeDirectory: string): Promise<void> {
    const before = await lstat(directory, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink()) {
      throw new SourceTreeScanError(
        "source_unsafe",
        "이전 관리 경로에는 실제 디렉터리만 사용할 수 있습니다.",
      );
    }
    treeHash.update(canonicalJson(["directory", relativeDirectory]));
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name === right.name ? 0 : left.name < right.name ? -1 : 1);
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? posix.join(relativeDirectory, entry.name)
        : entry.name;
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await visit(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new SourceTreeScanError(
          "source_unsafe",
          `이전 관리 경로의 ${relativePath}은 일반 파일이나 디렉터리가 아닙니다.`,
        );
      }
      fileCount += 1;
      if (fileCount > MAX_SOURCE_FILES) {
        scanLimit(`이전 관리 파일 수가 안전한 한도 ${MAX_SOURCE_FILES}개를 넘습니다.`);
      }
      const fileBefore = await lstat(absolutePath, { bigint: true });
      if (!fileBefore.isFile() || fileBefore.isSymbolicLink()) {
        throw new SourceTreeScanError("source_unsafe", `${relativePath}을 안전하게 읽을 수 없습니다.`);
      }
      const size = Number(fileBefore.size);
      if (!Number.isSafeInteger(size) || byteCount + size > MAX_SOURCE_BYTES) {
        scanLimit("이전 관리 데이터가 안전한 전체 byte 한도를 넘습니다.");
      }
      byteCount += size;
      const contentHash = createHash("sha256");
      for await (const chunk of createReadStream(absolutePath, { flags: "r" })) {
        contentHash.update(chunk as Buffer);
      }
      const fileAfter = await lstat(absolutePath, { bigint: true });
      if (
        !fileAfter.isFile() || fileAfter.isSymbolicLink() ||
        fileBefore.dev !== fileAfter.dev || fileBefore.ino !== fileAfter.ino ||
        fileBefore.size !== fileAfter.size || fileBefore.mtimeNs !== fileAfter.mtimeNs ||
        fileBefore.ctimeNs !== fileAfter.ctimeNs
      ) {
        throw new SourceTreeScanError(
          "source_changed",
          `${relativePath}이 읽는 동안 바뀌었습니다. 실행 중인 도구를 종료하고 다시 확인하세요.`,
        );
      }
      treeHash.update(canonicalJson([
        "file",
        relativePath,
        size,
        `sha256:${contentHash.digest("hex")}`,
      ]));
    }
    const after = await lstat(directory, { bigint: true });
    if (
      !after.isDirectory() || after.isSymbolicLink() || before.dev !== after.dev ||
      before.ino !== after.ino || before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    ) {
      throw new SourceTreeScanError(
        "source_changed",
        "이전 관리 경로가 검사 중 바뀌었습니다. 실행 중인 도구를 종료하고 다시 확인하세요.",
      );
    }
  }

  await visit(root, "");
  return { hash: `sha256:${treeHash.digest("hex")}`, fileCount, byteCount };
}
