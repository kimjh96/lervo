import { lstat, readdir, realpath } from "node:fs/promises";
import { relative } from "node:path";

import {
  absoluteRepositoryPath,
  canonicalRepositoryRoot,
  normalizeScanPath,
  readStableFile,
} from "./filesystem.js";
import { sha256 } from "./hash.js";
import {
  DocumentMigrationError,
  type DocumentScanLimits,
  type ScannedDocumentSource,
} from "./types.js";

export const defaultDocumentScanLimits: Readonly<DocumentScanLimits> = {
  maximumFiles: 4096,
  maximumFileBytes: 4 * 1024 * 1024,
  maximumTotalBytes: 64 * 1024 * 1024,
};

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function isExcluded(path: string, configured: ReadonlySet<string>): boolean {
  const segments = path.split("/");
  if (segments.includes(".git") || segments.includes("node_modules")) return true;
  if (path === ".lervo/state" || path.startsWith(".lervo/state/")) return true;
  for (const excluded of configured) {
    if (path === excluded || path.startsWith(`${excluded}/`)) return true;
  }
  return false;
}

function validateLimits(limits: DocumentScanLimits): void {
  if (
    !Number.isSafeInteger(limits.maximumFiles) || limits.maximumFiles < 1 ||
    limits.maximumFiles > defaultDocumentScanLimits.maximumFiles ||
    !Number.isSafeInteger(limits.maximumFileBytes) || limits.maximumFileBytes < 1 ||
    limits.maximumFileBytes > defaultDocumentScanLimits.maximumFileBytes ||
    !Number.isSafeInteger(limits.maximumTotalBytes) || limits.maximumTotalBytes < 1 ||
    limits.maximumTotalBytes > defaultDocumentScanLimits.maximumTotalBytes
  ) {
    throw new DocumentMigrationError(
      "invalid_scan_request",
      "문서 탐색 한도는 안전한 기본 상한 안의 양의 정수여야 합니다.",
    );
  }
}

async function listFiles(input: {
  root: string;
  path: string;
  excluded: ReadonlySet<string>;
  traversal: {
    visitedPaths: Set<string>;
    visitedEntries: number;
    maximumEntries: number;
  };
}): Promise<string[]> {
  if (isExcluded(input.path, input.excluded)) return [];
  if (input.traversal.visitedPaths.has(input.path)) return [];
  input.traversal.visitedPaths.add(input.path);
  input.traversal.visitedEntries += 1;
  if (input.traversal.visitedEntries > input.traversal.maximumEntries) {
    throw new DocumentMigrationError(
      "scan_limit_exceeded",
      "문서 탐색 디렉터리 항목 수 제한을 넘었습니다.",
    );
  }
  const absolute = absoluteRepositoryPath(input.root, input.path);
  let before;
  try {
    before = await lstat(absolute, { bigint: true });
  } catch (error) {
    throw new DocumentMigrationError(
      "unsafe_source",
      `문서 탐색 root를 확인할 수 없습니다: ${input.path}`,
      { cause: error },
    );
  }
  if (before.isSymbolicLink()) {
    throw new DocumentMigrationError(
      "unsafe_source",
      `문서 탐색 경로에 symbolic link가 있습니다: ${input.path}`,
    );
  }
  if (before.isFile()) return [input.path];
  if (!before.isDirectory() || await realpath(absolute) !== absolute) {
    throw new DocumentMigrationError(
      "unsafe_source",
      `문서 탐색 경로는 실제 파일 또는 디렉터리여야 합니다: ${input.path}`,
    );
  }
  const entries = await readdir(absolute, { withFileTypes: true });
  const after = await lstat(absolute, { bigint: true });
  if (
    before.dev !== after.dev || before.ino !== after.ino ||
    before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
  ) {
    throw new DocumentMigrationError(
      "unsafe_source",
      `문서 디렉터리가 탐색 중 바뀌었습니다: ${input.path}`,
    );
  }
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    const path = input.path === "." ? entry.name : `${input.path}/${entry.name}`;
    if (isExcluded(path, input.excluded)) continue;
    if (entry.isSymbolicLink()) {
      throw new DocumentMigrationError(
        "unsafe_source",
        `문서 탐색 경로에 symbolic link가 있습니다: ${path}`,
      );
    }
    files.push(...await listFiles({ ...input, path }));
  }
  return files;
}

export async function scanDocumentSources(input: {
  repositoryRoot: string;
  roots: readonly string[];
  excludePaths?: readonly string[];
  limits?: Partial<DocumentScanLimits>;
}): Promise<readonly ScannedDocumentSource[]> {
  if (input.roots.length === 0) {
    throw new DocumentMigrationError(
      "invalid_scan_request",
      "문서 탐색 root를 하나 이상 지정해야 합니다.",
    );
  }
  const limits = { ...defaultDocumentScanLimits, ...input.limits };
  validateLimits(limits);
  const root = await canonicalRepositoryRoot(input.repositoryRoot);
  const roots = [...new Set(input.roots.map(normalizeScanPath))].sort(compareText);
  const excluded = new Set((input.excludePaths ?? []).map(normalizeScanPath));
  const paths = new Set<string>();
  const traversal = {
    visitedPaths: new Set<string>(),
    visitedEntries: 0,
    maximumEntries: limits.maximumFiles * 4,
  };
  for (const scanRoot of roots) {
    for (const path of await listFiles({ root, path: scanRoot, excluded, traversal })) {
      paths.add(path);
    }
    if (paths.size > limits.maximumFiles) {
      throw new DocumentMigrationError(
        "scan_limit_exceeded",
        "문서 탐색 파일 수 제한을 넘었습니다.",
      );
    }
  }
  const sources: ScannedDocumentSource[] = [];
  let totalBytes = 0;
  for (const path of [...paths].sort(compareText)) {
    const bytes = await readStableFile(root, path, limits.maximumFileBytes);
    totalBytes += bytes.byteLength;
    if (totalBytes > limits.maximumTotalBytes) {
      throw new DocumentMigrationError(
        "scan_limit_exceeded",
        "문서 탐색 전체 byte 제한을 넘었습니다.",
      );
    }
    sources.push({
      path: relative(root, absoluteRepositoryPath(root, path)).split("\\").join("/"),
      contentHash: sha256(bytes),
      byteCount: bytes.byteLength,
      bytes,
    });
  }
  return sources;
}
