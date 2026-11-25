import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

import type { EventDraftV3 } from "@lervo/event-contract";
import type { OutboxTransaction } from "@lervo/storage-contract";

import type { RepositoryKnowledgeJobAdmission } from "./repository-knowledge-job-admission.js";
import {
  knowledgeIntakeDisposition,
  loadKnowledgeIntakePolicy,
  type KnowledgeIntakeDisposition,
} from "./knowledge-intake-policy.js";

/** Durable knowledge jobs for every repository change unit (ADR-0433). */
export const REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION = "knowledge:repository";
export const MAXIMUM_REPOSITORY_CHANGE_PUBLISHED_PATHS = 64;
export const MAXIMUM_REPOSITORY_KNOWLEDGE_OUTSTANDING = 1_024;
const MAXIMUM_MANIFEST_BYTES = 1_048_576;

export type RepositoryChangeSourceKind = "conversation" | "managed_run" | "terminal_turn";

/** A path-to-digest observation; digests are compared, never interpreted. */
export interface RepositoryChangeSnapshot {
  revision: string;
  files: Readonly<Record<string, string>>;
  /** Exact Git coordinates observed with the bytes, never a later HEAD guess. */
  commits?: Readonly<Record<string, string>>;
}

export interface PlannedRepositoryChange {
  manifestContent: string;
  payload: {
    sourceKind: RepositoryChangeSourceKind;
    sourceEventId: string;
    repositoryRevisionBefore: string;
    repositoryRevisionAfter: string;
    changedPathCount: number;
    changedPaths: string[];
    sourceManifest: { contentHash: string; byteCount: number };
    occurredAt: string;
  };
}

export class RepositoryChangeSourceError extends Error {
  constructor(readonly code: "repository_change_manifest_limit_exceeded") {
    super("The repository change source manifest exceeds its bound.");
    this.name = "RepositoryChangeSourceError";
  }
}

function manifestSchemaVersion(input: {
  projectId?: string;
  before: RepositoryChangeSnapshot;
  disposition?: unknown;
}): 1 | 2 | 3 | 4 {
  if (input.disposition !== undefined) return 4;
  if (input.projectId !== undefined) return 3;
  return input.before.commits === undefined ? 1 : 2;
}

/**
 * Null for an unchanged unit, or for one whose every change is generated. The manifest keeps every
 * changed path and both digests; schema version 4 records each path's intake disposition, so
 * generated paths stay counted instead of silently dropped (ADR-0457).
 */
export function planRepositoryChange(input: {
  projectId?: string;
  sourceKind: RepositoryChangeSourceKind;
  sourceEventId: string;
  before: RepositoryChangeSnapshot;
  after: RepositoryChangeSnapshot;
  occurredAt: string;
  disposition?: (path: string) => KnowledgeIntakeDisposition;
}): PlannedRepositoryChange | null {
  const paths = [
    ...new Set([...Object.keys(input.before.files), ...Object.keys(input.after.files)]),
  ]
    .filter((path) => input.before.files[path] !== input.after.files[path])
    .sort();
  const dispositions = new Map(
    paths.map((path) => [path, input.disposition?.(path) ?? ("reviewable" as const)]),
  );
  if (![...dispositions.values()].includes("reviewable")) return null;
  const schemaVersion = manifestSchemaVersion(input);
  const manifestContent = JSON.stringify({
    schemaVersion,
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    kind: "repository.change.source_manifest",
    sourceKind: input.sourceKind,
    sourceEventId: input.sourceEventId,
    repositoryRevisionBefore: input.before.revision,
    repositoryRevisionAfter: input.after.revision,
    paths: paths.map((path) => ({
      path,
      before: input.before.files[path] ?? null,
      after: input.after.files[path] ?? null,
      ...(schemaVersion === 1 ? {} : { beforeCommit: input.before.commits?.[path] ?? null }),
      ...(schemaVersion === 4 ? { disposition: dispositions.get(path) } : {}),
    })),
  });
  const byteCount = Buffer.byteLength(manifestContent);
  if (byteCount > MAXIMUM_MANIFEST_BYTES)
    throw new RepositoryChangeSourceError("repository_change_manifest_limit_exceeded");
  return {
    manifestContent,
    payload: {
      sourceKind: input.sourceKind,
      sourceEventId: input.sourceEventId,
      repositoryRevisionBefore: input.before.revision,
      repositoryRevisionAfter: input.after.revision,
      changedPathCount: paths.length,
      changedPaths: paths.length > MAXIMUM_REPOSITORY_CHANGE_PUBLISHED_PATHS ? [] : paths,
      sourceManifest: {
        contentHash: `sha256:${createHash("sha256").update(manifestContent).digest("hex")}`,
        byteCount,
      },
      occurredAt: input.occurredAt,
    },
  };
}

/**
 * Appends the change event and its knowledge job in the caller's transaction. A full queue leaves
 * the canonical event discoverable for reconciliation instead of dropping it. ADR-0605: the job is
 * enqueued only when `admission` admits this host, which every writer must decide; the event is
 * appended either way.
 */
export function appendRepositoryChange(
  transaction: OutboxTransaction,
  draft: Omit<EventDraftV3, "type" | "payload" | "schemaVersion">,
  planned: PlannedRepositoryChange,
  admission: RepositoryKnowledgeJobAdmission,
): { eventId: string; enqueued: boolean } {
  const appended = transaction.append({
    ...draft,
    schemaVersion: 3,
    type: "repository.change.completed",
    payload: planned.payload,
  });
  if (appended.redactions.length !== 0)
    throw new Error("The repository change event must not require redaction.");
  const enqueued =
    admission.admitted &&
    transaction.outstandingCount(REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION) <
      MAXIMUM_REPOSITORY_KNOWLEDGE_OUTSTANDING &&
    transaction.enqueue({
      eventId: draft.eventId,
      destinationId: REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
      enqueuedAt: planned.payload.occurredAt,
    }).inserted;
  return { eventId: draft.eventId, enqueued };
}

/**
 * The untracked paths Git ignores, such as build outputs. Git never reports a tracked file, and a
 * root outside Git or an unavailable Git ignores nothing, so no source is silently dropped.
 */
function gitIgnoredPaths(root: string, paths: readonly string[]): Promise<ReadonlySet<string>> {
  if (paths.length === 0) return Promise.resolve(new Set());
  return new Promise((settle) => {
    const child = spawn("git", ["check-ignore", "-z", "--stdin"], {
      cwd: root,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", () => settle(new Set()));
    child.on("close", (code) =>
      settle(
        code === 0
          ? new Set(Buffer.concat(chunks).toString("utf8").split("\0").filter(Boolean))
          : new Set(),
      ),
    );
    child.stdin.on("error", () => undefined);
    child.stdin.end(paths.map((path) => `${path}\0`).join(""));
  });
}

/**
 * Plans a change unit after removing Git-ignored paths, which are untracked build outputs. Paths
 * the shared intake policy marks as generated stay in the manifest as `disposition: generated`.
 */
export async function planRepositoryChangeInRepository(
  input: Parameters<typeof planRepositoryChange>[0] & { repositoryRoot: string },
): Promise<PlannedRepositoryChange | null> {
  const { repositoryRoot, ...change } = input;
  // Only changed paths reach the manifest, so only they need Git's ignore rules. Feeding every
  // path cost about 700 ms per Stop in a 9,000-file repository.
  const changed = [
    ...new Set([...Object.keys(change.before.files), ...Object.keys(change.after.files)]),
  ].filter((path) => change.before.files[path] !== change.after.files[path]);
  const [ignored, intake] = await Promise.all([
    gitIgnoredPaths(repositoryRoot, changed),
    loadKnowledgeIntakePolicy(repositoryRoot),
  ]);
  const kept = (files: Readonly<Record<string, string>>) =>
    Object.fromEntries(Object.entries(files).filter(([path]) => !ignored.has(path)));
  return planRepositoryChange({
    ...change,
    before: { ...change.before, files: kept(change.before.files) },
    after: { ...change.after, files: kept(change.after.files) },
    disposition: (path) => knowledgeIntakeDisposition(path, intake),
  });
}
