import { execFile } from "node:child_process";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

import type { ArtifactStore, OutboxDelivery } from "@lervo/storage-contract";

import { sha256 } from "./integrity.js";
import {
  TerminalOutcome,
  type RepositoryKnowledgeReviewSource,
} from "./repository-knowledge-worker-contract.js";

const run = promisify(execFile);
const MAXIMUM_REVIEW_BYTES = 256 * 1024;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40,64}$/u;

export interface RepositoryKnowledgeSourceManifest {
  paths: {
    path: string;
    before: string | null;
    after: string | null;
    beforeCommit?: string | null;
  }[];
}

function invalid(): never {
  throw new TerminalOutcome("attention_required", "knowledge_job_source_invalid");
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 500 &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !value.includes(":") &&
    !value.split("/").some((part) => part === "" || part === "." || part === "..")
  );
}

/** The manifest's private bytes must agree with every published coordinate before any path is read. */
export async function readManifest(
  artifacts: ArtifactStore,
  delivery: OutboxDelivery,
): Promise<RepositoryKnowledgeSourceManifest> {
  const payload = delivery.event.payload as Record<string, unknown>;
  const reference = payload.sourceManifest;
  if (
    !record(reference) ||
    typeof reference.contentHash !== "string" ||
    !HASH.test(reference.contentHash) ||
    !Number.isInteger(reference.byteCount) ||
    (reference.byteCount as number) < 1 ||
    (reference.byteCount as number) > 1_048_576
  )
    invalid();
  const uri = `lervo-cas://sha256/${reference.contentHash.slice(7)}`;
  if (!(await artifacts.has(uri)))
    throw new TerminalOutcome("attention_required", "knowledge_job_source_unavailable");
  const bytes = await artifacts.get(uri);
  if (bytes.byteLength !== reference.byteCount || sha256(bytes) !== reference.contentHash)
    invalid();
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
  } catch {
    invalid();
  }
  if (
    !record(value) ||
    ![1, 2, 3].includes(value.schemaVersion as number) ||
    (value.schemaVersion === 3 && value.projectId !== delivery.event.projectId) ||
    value.kind !== "repository.change.source_manifest" ||
    value.sourceKind !== payload.sourceKind ||
    value.sourceEventId !== payload.sourceEventId ||
    value.repositoryRevisionBefore !== payload.repositoryRevisionBefore ||
    value.repositoryRevisionAfter !== payload.repositoryRevisionAfter ||
    !Array.isArray(value.paths) ||
    value.paths.length !== payload.changedPathCount ||
    value.paths.length === 0 ||
    value.paths.length > 64 ||
    Object.keys(value).sort().join() !==
      [
        ...(value.schemaVersion === 3 ? ["projectId"] : []),
        "schemaVersion",
        "kind",
        "sourceKind",
        "sourceEventId",
        "repositoryRevisionBefore",
        "repositoryRevisionAfter",
        "paths",
      ]
        .sort()
        .join()
  )
    invalid();
  let preceding = "";
  const paths: RepositoryKnowledgeSourceManifest["paths"] = [];
  for (const entry of value.paths) {
    if (
      !record(entry) ||
      !safePath(entry.path) ||
      entry.path <= preceding ||
      ![entry.before, entry.after].every(
        (hash) => hash === null || (typeof hash === "string" && HASH.test(hash)),
      ) ||
      entry.before === entry.after ||
      Object.keys(entry).sort().join() !==
        (value.schemaVersion === 1
          ? ["path", "before", "after"]
          : ["path", "before", "after", "beforeCommit"]
        )
          .sort()
          .join() ||
      (value.schemaVersion !== 1 &&
        !(
          entry.beforeCommit === null ||
          (typeof entry.beforeCommit === "string" && COMMIT.test(entry.beforeCommit))
        ))
    )
      invalid();
    preceding = entry.path;
    paths.push(entry as unknown as RepositoryKnowledgeSourceManifest["paths"][number]);
  }
  if (JSON.stringify(paths.map((entry) => entry.path)) !== JSON.stringify(payload.changedPaths))
    invalid();
  return { paths };
}

/** Reject symlinks in every component, including a dangling parent of a missing path. */
function currentBytes(root: string, path: string): Uint8Array | null {
  if (!safePath(path)) invalid();
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
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) invalid();
    if (stat.size > MAXIMUM_REVIEW_BYTES)
      throw new TerminalOutcome("attention_required", "review_source_limit_exceeded");
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/** Synchronous fence: no awaited work can run between this check and the event transaction. */
export function assertReviewSourcesCurrent(
  root: string,
  manifest: RepositoryKnowledgeSourceManifest,
): void {
  for (const entry of manifest.paths) {
    const bytes = currentBytes(root, entry.path);
    if ((bytes === null ? null : sha256(bytes)) !== entry.after)
      throw new TerminalOutcome("stale", "source_bytes_changed");
  }
}

async function beforeBytes(
  root: string,
  entry: RepositoryKnowledgeSourceManifest["paths"][number],
): Promise<Uint8Array | null> {
  if (entry.before === null || entry.beforeCommit == null) return null;
  try {
    const { stdout } = await run(
      "git",
      ["cat-file", "blob", `${entry.beforeCommit}:${entry.path}`],
      { cwd: root, encoding: "buffer", maxBuffer: MAXIMUM_REVIEW_BYTES },
    );
    return sha256(stdout) === entry.before ? stdout : null;
  } catch {
    return null;
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

export async function reviewSources(
  root: string,
  manifest: RepositoryKnowledgeSourceManifest,
): Promise<RepositoryKnowledgeReviewSource[]> {
  let byteCount = 0;
  const sources: RepositoryKnowledgeReviewSource[] = [];
  for (const entry of manifest.paths) {
    const current = currentBytes(root, entry.path);
    if ((current === null ? null : sha256(current)) !== entry.after)
      throw new TerminalOutcome("stale", "source_bytes_changed");
    const former = await beforeBytes(root, entry);
    const afterText = current === null ? null : text(current);
    const beforeText = former === null ? null : text(former);
    byteCount += (current?.byteLength ?? 0) + (former?.byteLength ?? 0);
    if (byteCount > MAXIMUM_REVIEW_BYTES)
      throw new TerminalOutcome("attention_required", "review_source_limit_exceeded");
    sources.push({
      path: entry.path,
      before:
        entry.before === null
          ? { kind: "missing" }
          : former !== null && beforeText === null
            ? { kind: "opaque", contentHash: entry.before }
            : beforeText === null
              ? { kind: "unavailable" }
              : { kind: "text", text: beforeText },
      after:
        current !== null && afterText === null
          ? { kind: "opaque", contentHash: entry.after! }
          : afterText === null
            ? { kind: "missing" }
            : { kind: "text", text: afterText },
    });
  }
  return sources;
}
