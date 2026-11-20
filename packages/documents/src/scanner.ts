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
  // Derived state, durable data and the live event-channel FIFOs are never documents (ADR-0602).
  for (const runtime of [".lervo/state", ".lervo/data", ".lervo/run"])
    if (path === runtime || path.startsWith(`${runtime}/`)) return true;
  for (const excluded of configured) {
    if (path === excluded || path.startsWith(`${excluded}/`)) return true;
  }
  return false;
}

function validateLimits(limits: DocumentScanLimits): void {
  if (
    !Number.isSafeInteger(limits.maximumFiles) ||
    limits.maximumFiles < 1 ||
    limits.maximumFiles > defaultDocumentScanLimits.maximumFiles ||
    !Number.isSafeInteger(limits.maximumFileBytes) ||
    limits.maximumFileBytes < 1 ||
    limits.maximumFileBytes > defaultDocumentScanLimits.maximumFileBytes ||
    !Number.isSafeInteger(limits.maximumTotalBytes) ||
    limits.maximumTotalBytes < 1 ||
    limits.maximumTotalBytes > defaultDocumentScanLimits.maximumTotalBytes
  ) {
    throw new DocumentMigrationError(
      "invalid_scan_request",
      "Document scan limits must be positive integers within the safe default bounds.",
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
      "The document scan directory-entry limit was exceeded.",
    );
  }
  const absolute = absoluteRepositoryPath(input.root, input.path);
  let before;
  try {
    before = await lstat(absolute, { bigint: true });
  } catch (error) {
    throw new DocumentMigrationError(
      "unsafe_source",
      `The document scan root cannot be inspected: ${input.path}`,
      { cause: error },
    );
  }
  if (before.isSymbolicLink()) {
    throw new DocumentMigrationError(
      "unsafe_source",
      `The document scan path contains a symbolic link: ${input.path}`,
    );
  }
  if (before.isFile()) return [input.path];
  if (!before.isDirectory() || (await realpath(absolute)) !== absolute) {
    throw new DocumentMigrationError(
      "unsafe_source",
      `The document scan path must be a real file or directory: ${input.path}`,
    );
  }
  const entries = await readdir(absolute, { withFileTypes: true });
  const after = await lstat(absolute, { bigint: true });
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs
  ) {
    throw new DocumentMigrationError(
      "unsafe_source",
      `The document directory changed during the scan: ${input.path}`,
    );
  }
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    const path = input.path === "." ? entry.name : `${input.path}/${entry.name}`;
    if (isExcluded(path, input.excluded)) continue;
    if (entry.isSymbolicLink()) {
      throw new DocumentMigrationError(
        "unsafe_source",
        `The document scan path contains a symbolic link: ${path}`,
      );
    }
    files.push(...(await listFiles({ ...input, path })));
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
      "At least one document scan root must be specified.",
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
        "The document scan file-count limit was exceeded.",
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
        "The document scan total-byte limit was exceeded.",
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
