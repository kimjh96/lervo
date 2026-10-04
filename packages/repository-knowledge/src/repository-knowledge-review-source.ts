import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { sha256 } from "./integrity.js";
import {
  knowledgeIntakeDisposition,
  type KnowledgeIntakePolicy,
} from "./knowledge-intake-policy.js";
import {
  safeRepositoryPath,
  type RepositoryKnowledgeSourceManifest,
  type RepositoryKnowledgeSourceManifestEntry,
} from "./repository-knowledge-source-manifest.js";
import {
  TerminalOutcome,
  type RepositoryKnowledgeReviewSource,
} from "./repository-knowledge-worker-contract.js";

export {
  readManifest,
  type RepositoryKnowledgeSourceManifest,
} from "./repository-knowledge-source-manifest.js";

const run = promisify(execFile);
/** The per-file review ceiling over the before and after bytes together (ADR-0457). */
export const MAXIMUM_REVIEW_FILE_BYTES = 256 * 1024;
/** A sub-job never exceeds the published path bound or the provider review-input ceiling. */
const MAXIMUM_SUB_JOB_PATHS = 64;
const MAXIMUM_SUB_JOB_BYTES = 256 * 1024;
const READ_CHUNK_BYTES = 1024 * 1024;

export type RepositoryKnowledgeSkipDisposition =
  "skipped_oversize" | "skipped_binary" | "skipped_generated";

export interface RepositoryKnowledgeSkippedPath {
  path: string;
  fileDisposition: RepositoryKnowledgeSkipDisposition;
}

export interface RepositoryKnowledgeReviewCapture {
  /** Exact reviewable sources in manifest order; each fits one sub-job alone. */
  sources: { source: RepositoryKnowledgeReviewSource; byteCount: number }[];
  skipped: RepositoryKnowledgeSkippedPath[];
}

function invalid(): never {
  throw new TerminalOutcome("attention_required", "knowledge_job_source_invalid");
}

/** Version-4 manifests carry the planner's disposition; older ones are classified now. */
function generated(entry: RepositoryKnowledgeSourceManifestEntry, intake: KnowledgeIntakePolicy) {
  return (
    entry.disposition === "generated" ||
    knowledgeIntakeDisposition(entry.path, intake) === "generated"
  );
}

/** Reject symlinks in every component, including a dangling parent of a missing path. */
function openCurrent(root: string, path: string): number | null {
  if (!safeRepositoryPath(path)) invalid();
  let target = resolve(root);
  for (const part of path.split("/")) {
    target = resolve(target, part);
    try {
      if (lstatSync(target).isSymbolicLink()) invalid();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  const descriptor = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  if (!fstatSync(descriptor).isFile()) {
    closeSync(descriptor);
    invalid();
  }
  return descriptor;
}

/**
 * Reads the current bytes and their digest. Bytes above `retainLimit` are hashed in chunks and not
 * retained, so an oversize file still proves its currency without entering memory whole.
 */
function readCurrent(
  root: string,
  path: string,
  retainLimit: number,
): { digest: string; bytes: Uint8Array | null; byteCount: number } | null {
  const descriptor = openCurrent(root, path);
  if (descriptor === null) return null;
  try {
    const size = fstatSync(descriptor).size;
    const hash = createHash("sha256");
    const retained: Buffer[] = [];
    const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    let byteCount = 0;
    for (;;) {
      const read = readSync(descriptor, chunk, 0, chunk.byteLength, null);
      if (read === 0) break;
      hash.update(chunk.subarray(0, read));
      if (size <= retainLimit) retained.push(Buffer.from(chunk.subarray(0, read)));
      byteCount += read;
    }
    return {
      digest: `sha256:${hash.digest("hex")}`,
      bytes: size <= retainLimit && byteCount <= retainLimit ? Buffer.concat(retained) : null,
      byteCount,
    };
  } finally {
    closeSync(descriptor);
  }
}

/**
 * The paths whose currency a reviewed claim depends on: every non-generated path, including the
 * oversize and binary ones that were skipped, because their change is part of the same unit.
 */
export function reviewFenceEntries(
  manifest: RepositoryKnowledgeSourceManifest,
  intake: KnowledgeIntakePolicy,
): RepositoryKnowledgeSourceManifestEntry[] {
  return manifest.paths.filter((entry) => !generated(entry, intake));
}

/** Synchronous fence: no awaited work can run between this check and the event transaction. */
export function assertReviewSourcesCurrent(
  root: string,
  entries: readonly RepositoryKnowledgeSourceManifestEntry[],
): void {
  for (const entry of entries)
    if ((readCurrent(root, entry.path, 0)?.digest ?? null) !== entry.after)
      throw new TerminalOutcome("stale", "source_bytes_changed");
}

type FormerBytes = Uint8Array | "oversize" | null;

async function beforeBytes(
  root: string,
  entry: RepositoryKnowledgeSourceManifestEntry,
): Promise<FormerBytes> {
  if (entry.before === null || entry.beforeCommit == null) return null;
  try {
    const { stdout } = await run(
      "git",
      ["cat-file", "blob", `${entry.beforeCommit}:${entry.path}`],
      { cwd: root, encoding: "buffer", maxBuffer: MAXIMUM_REVIEW_FILE_BYTES },
    );
    return sha256(stdout) === entry.before ? stdout : null;
  } catch (error) {
    return (error as { code?: unknown }).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
      ? "oversize"
      : null;
  }
}

function text(bytes: Uint8Array): string | null {
  try {
    const value = new TextDecoder("utf8", { fatal: true }).decode(bytes);
    return value.includes("\0") ? null : value;
  } catch {
    return null;
  }
}

/**
 * Reads every manifest path and degrades per file: a generated, oversize, or binary path is
 * recorded as skipped and the remaining paths stay reviewable. Changed bytes remain `stale`.
 */
export async function captureReviewSources(
  root: string,
  manifest: RepositoryKnowledgeSourceManifest,
  intake: KnowledgeIntakePolicy,
): Promise<RepositoryKnowledgeReviewCapture> {
  const capture: RepositoryKnowledgeReviewCapture = { sources: [], skipped: [] };
  const skip = (path: string, fileDisposition: RepositoryKnowledgeSkipDisposition) =>
    capture.skipped.push({ path, fileDisposition });
  for (const entry of manifest.paths) {
    if (generated(entry, intake)) {
      skip(entry.path, "skipped_generated");
      continue;
    }
    const current = readCurrent(root, entry.path, MAXIMUM_REVIEW_FILE_BYTES);
    if ((current?.digest ?? null) !== entry.after)
      throw new TerminalOutcome("stale", "source_bytes_changed");
    const former = await beforeBytes(root, entry);
    const formerCount = former instanceof Uint8Array ? former.byteLength : 0;
    if (
      former === "oversize" ||
      (current !== null && current.bytes === null) ||
      (current?.byteCount ?? 0) + formerCount > MAXIMUM_REVIEW_FILE_BYTES
    ) {
      skip(entry.path, "skipped_oversize");
      continue;
    }
    const afterText = current?.bytes == null ? null : text(current.bytes);
    const beforeText = former instanceof Uint8Array ? text(former) : null;
    if ((current !== null && afterText === null) || (former !== null && beforeText === null)) {
      skip(entry.path, "skipped_binary");
      continue;
    }
    capture.sources.push({
      byteCount: (current?.byteCount ?? 0) + formerCount,
      source: {
        path: entry.path,
        before:
          entry.before === null
            ? { kind: "missing" }
            : beforeText === null
              ? { kind: "unavailable" }
              : { kind: "text", text: beforeText },
        after: afterText === null ? { kind: "missing" } : { kind: "text", text: afterText },
      },
    });
  }
  return capture;
}

/** Ordered sub-jobs bounded by path count and review bytes; one file always fits alone. */
export function partitionReviewSubJobs(
  sources: RepositoryKnowledgeReviewCapture["sources"],
): RepositoryKnowledgeReviewSource[][] {
  const subJobs: RepositoryKnowledgeReviewSource[][] = [];
  let current: RepositoryKnowledgeReviewSource[] = [];
  let bytes = 0;
  for (const { source, byteCount } of sources) {
    if (
      current.length === MAXIMUM_SUB_JOB_PATHS ||
      (current.length > 0 && bytes + byteCount > MAXIMUM_SUB_JOB_BYTES)
    ) {
      subJobs.push(current);
      current = [];
      bytes = 0;
    }
    current.push(source);
    bytes += byteCount;
  }
  if (current.length > 0) subJobs.push(current);
  return subJobs;
}
