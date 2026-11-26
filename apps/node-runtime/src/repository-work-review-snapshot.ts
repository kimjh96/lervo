import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readlink } from "node:fs/promises";
import { resolve } from "node:path";

import {
  readRepositoryWorkGitBlob,
  readRepositoryWorkGitTreeEntry,
  RepositoryWorkGitBlobLimitError,
} from "./repository-work-git-objects.js";
import {
  inspectRepositoryWorkSourceCurrency,
  type RepositoryWorkSourceCurrency,
} from "./repository-work-source-currency.js";
import {
  parseRepositoryWorkSourceManifest,
  type RepositoryWorkSourceManifest,
  type SourceCoordinate,
} from "./repository-work-source-manifest.js";

export const MAXIMUM_REVIEW_SOURCE_BYTES = 16 * 1024 * 1024;

export type ReviewSourceValue =
  | { kind: "missing" }
  | {
      kind: "file" | "link";
      content: Uint8Array;
      contentHash: string;
      executable: boolean;
    };

export type RepositoryWorkReviewSnapshot =
  | {
      status: "ready_for_review";
      paths: Array<{ path: string; before: ReviewSourceValue; after: ReviewSourceValue }>;
      changedPathCount: number;
      totalByteCount: number;
    }
  | {
      status: "stale" | "needs_review";
      changedPathCount: number;
      reasonCode:
        | Exclude<RepositoryWorkSourceCurrency, { status: "ready_for_review" }>["reasonCode"]
        | "review_source_kind_unsupported";
    };

export class RepositoryWorkReviewSnapshotError extends Error {
  readonly code = "review_source_limit_exceeded";

  constructor(options?: ErrorOptions) {
    super("The repository review source exceeds its byte bound.", options);
    this.name = "RepositoryWorkReviewSnapshotError";
  }
}

class UnsupportedReviewSourceKindError extends Error {}
class ChangedReviewSourceError extends Error {}

function hash(content: Uint8Array): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function sourceValue(
  kind: "file" | "link",
  content: Uint8Array,
  executable: boolean,
): ReviewSourceValue {
  return { kind, content, contentHash: hash(content), executable };
}

async function readGitCoordinate(input: {
  repositoryRoot: string;
  path: string;
  commit: string;
  remainingBytes: number;
}): Promise<ReviewSourceValue> {
  const entry = await readRepositoryWorkGitTreeEntry(
    input.repositoryRoot,
    input.commit,
    input.path,
  );
  if (entry === null) return { kind: "missing" };
  if (entry.type !== "blob" || !["100644", "100755", "120000"].includes(entry.mode))
    throw new UnsupportedReviewSourceKindError();
  const content = await readRepositoryWorkGitBlob({
    repositoryRoot: input.repositoryRoot,
    objectId: entry.objectId,
    maximumBytes: input.remainingBytes,
  });
  return sourceValue(entry.mode === "120000" ? "link" : "file", content, entry.mode === "100755");
}

async function readWorkingCoordinate(input: {
  repositoryRoot: string;
  path: string;
  digest: string;
  remainingBytes: number;
}): Promise<ReviewSourceValue> {
  const absolute = resolve(input.repositoryRoot, input.path);
  const metadata = await lstat(absolute);
  if (metadata.isSymbolicLink()) {
    const target = await readlink(absolute);
    const content = Buffer.from(target, "utf8");
    if (content.byteLength > input.remainingBytes) throw new RepositoryWorkReviewSnapshotError();
    if (`link:${hash(content).slice("sha256:".length)}` !== input.digest)
      throw new ChangedReviewSourceError();
    return sourceValue("link", content, false);
  }
  if (!metadata.isFile()) throw new UnsupportedReviewSourceKindError();
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) throw new UnsupportedReviewSourceKindError();
    if (opened.size > input.remainingBytes) throw new RepositoryWorkReviewSnapshotError();
    const content = await handle.readFile();
    if (content.byteLength > input.remainingBytes) throw new RepositoryWorkReviewSnapshotError();
    if (`file:${opened.mode}:${hash(content).slice("sha256:".length)}` !== input.digest)
      throw new ChangedReviewSourceError();
    return sourceValue("file", content, (opened.mode & 0o111) !== 0);
  } finally {
    await handle.close();
  }
}

async function readCoordinate(input: {
  repositoryRoot: string;
  path: string;
  coordinate: SourceCoordinate;
  remainingBytes: number;
}): Promise<ReviewSourceValue> {
  if (input.coordinate.kind === "missing") return { kind: "missing" };
  if (input.coordinate.kind === "git_tree")
    return readGitCoordinate({ ...input, commit: input.coordinate.commit });
  return readWorkingCoordinate({ ...input, digest: input.coordinate.digest });
}

function byteCount(value: ReviewSourceValue): number {
  return value.kind === "missing" ? 0 : value.content.byteLength;
}

/** Captures exact before/after bytes in memory; no repository or public event receives source content. */
export async function readRepositoryWorkReviewSnapshot(input: {
  repositoryRoot: string;
  manifest: RepositoryWorkSourceManifest;
  maximumBytes?: number;
}): Promise<RepositoryWorkReviewSnapshot> {
  const maximumBytes = input.maximumBytes ?? MAXIMUM_REVIEW_SOURCE_BYTES;
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    maximumBytes > MAXIMUM_REVIEW_SOURCE_BYTES
  )
    throw new TypeError("The repository review source byte bound is invalid.");
  const manifest = parseRepositoryWorkSourceManifest(
    Buffer.from(JSON.stringify(input.manifest), "utf8"),
  );
  const first = await inspectRepositoryWorkSourceCurrency({
    repositoryRoot: input.repositoryRoot,
    manifest,
  });
  if (first.status !== "ready_for_review") return first;
  const paths: Array<{ path: string; before: ReviewSourceValue; after: ReviewSourceValue }> = [];
  let totalByteCount = 0;
  try {
    for (const item of manifest.paths) {
      const before = await readCoordinate({
        repositoryRoot: input.repositoryRoot,
        path: item.path,
        coordinate: item.before,
        remainingBytes: maximumBytes - totalByteCount,
      });
      totalByteCount += byteCount(before);
      const after = await readCoordinate({
        repositoryRoot: input.repositoryRoot,
        path: item.path,
        coordinate: item.after,
        remainingBytes: maximumBytes - totalByteCount,
      });
      totalByteCount += byteCount(after);
      paths.push({ path: item.path, before, after });
    }
  } catch (error) {
    if (
      error instanceof RepositoryWorkReviewSnapshotError ||
      error instanceof RepositoryWorkGitBlobLimitError
    )
      throw new RepositoryWorkReviewSnapshotError({ cause: error });
    if (error instanceof UnsupportedReviewSourceKindError)
      return {
        status: "needs_review",
        changedPathCount: manifest.paths.length,
        reasonCode: "review_source_kind_unsupported",
      };
    if (error instanceof ChangedReviewSourceError)
      return {
        status: "stale",
        changedPathCount: manifest.paths.length,
        reasonCode: "source_bytes_changed",
      };
    const currency = await inspectRepositoryWorkSourceCurrency({
      repositoryRoot: input.repositoryRoot,
      manifest,
    });
    if (currency.status !== "ready_for_review") return currency;
    return {
      status: "needs_review",
      changedPathCount: manifest.paths.length,
      reasonCode: "source_evidence_unavailable",
    };
  }
  const final = await inspectRepositoryWorkSourceCurrency({
    repositoryRoot: input.repositoryRoot,
    manifest,
  });
  return final.status === "ready_for_review"
    ? { status: "ready_for_review", paths, changedPathCount: paths.length, totalByteCount }
    : final;
}
