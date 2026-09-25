import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

import type { ArtifactStore } from "@lervo/storage-contract";
import {
  planRepositoryChange,
  type PlannedRepositoryChange,
  type RepositoryChangeSnapshot,
} from "@lervo/repository-knowledge";

import type {
  PreparedRepositoryWorkSourceManifest,
  SourceCoordinate,
} from "./repository-work-source-manifest.js";

const run = promisify(execFile);
const MAXIMUM_BLOB_BYTES = 64 * 1024 * 1024;

/** The plain byte digest the repository knowledge worker compares; null is an absent path. */
async function byteDigest(
  root: string,
  path: string,
  coordinate: SourceCoordinate,
): Promise<string | null | "unsupported"> {
  if (coordinate.kind === "missing") return null;
  if (coordinate.kind === "working_tree") {
    const file = /^file:[0-9]+:([a-f0-9]{64})$/u.exec(coordinate.digest);
    // Links and special files have no regular-file bytes for a semantic review.
    return file === null ? "unsupported" : `sha256:${file[1]}`;
  }
  try {
    await run("git", ["rev-parse", "--verify", "--quiet", `${coordinate.commit}^{commit}`], {
      cwd: root,
    });
  } catch {
    return "unsupported";
  }
  try {
    const { stdout } = await run("git", ["cat-file", "blob", `${coordinate.commit}:${path}`], {
      cwd: root,
      encoding: "buffer",
      maxBuffer: MAXIMUM_BLOB_BYTES,
    });
    return `sha256:${createHash("sha256").update(stdout).digest("hex")}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
      return "unsupported";
    // The commit exists, so an unreadable entry is absent from its tree.
    return null;
  }
}

/**
 * The ADR-0433 knowledge source for a completed conversation turn. It stores the change manifest
 * before the completion transaction; unsupported coordinates record no background job.
 */
export async function planConversationRepositoryChange(input: {
  repositoryRoot: string;
  artifacts: Pick<ArtifactStore, "put">;
  sourceManifest: PreparedRepositoryWorkSourceManifest;
  completionEventId: string;
  completedAt: string;
}): Promise<PlannedRepositoryChange | null> {
  const { manifest } = input.sourceManifest;
  const before: Record<string, string> = {};
  const after: Record<string, string> = {};
  for (const entry of manifest.paths) {
    const [former, latter] = await Promise.all([
      byteDigest(input.repositoryRoot, entry.path, entry.before),
      byteDigest(input.repositoryRoot, entry.path, entry.after),
    ]);
    if (former === "unsupported" || latter === "unsupported") return null;
    if (former !== null) before[entry.path] = former;
    if (latter !== null) after[entry.path] = latter;
  }
  const snapshot = (revision: string, files: Record<string, string>): RepositoryChangeSnapshot => ({
    revision,
    files,
  });
  const planned = planRepositoryChange({
    sourceKind: "conversation",
    sourceEventId: input.completionEventId,
    before: snapshot(manifest.repositoryRevisionBefore, before),
    after: snapshot(manifest.repositoryRevisionAfter, after),
    occurredAt: input.completedAt,
  });
  if (planned === null) return null;
  const stored = await input.artifacts.put(planned.manifestContent);
  if (stored.contentHash !== planned.payload.sourceManifest.contentHash)
    throw new Error("The repository change manifest differs from its stored artifact.");
  return planned;
}

export function conversationRepositoryChangeEventId(completionEventId: string): string {
  return `evt_${createHash("sha256").update(`lervo.conversation.repository-change.v1\0${completionEventId}`).digest("hex").slice(0, 32)}`;
}
