import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import type { ArtifactStore, OutboxDelivery, OutboxStore } from "@lervo/storage-contract";

import {
  MAXIMUM_REPOSITORY_CHANGE_PUBLISHED_PATHS,
  REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
  type RepositoryChangeSourceKind,
} from "./repository-change-source.js";

const run = promisify(execFile);
const MAXIMUM_ATTEMPTS = 16;
const MAXIMUM_REVIEW_BYTES = 256 * 1024;
const DEFAULT_LEASE_MS = 30 * 60_000;

/** Exact before/after text of one changed path; `unavailable` bytes are never guessed. */
export interface RepositoryKnowledgeReviewSource {
  path: string;
  before: { kind: "text"; text: string } | { kind: "missing" } | { kind: "unavailable" };
  after: { kind: "text"; text: string } | { kind: "missing" };
}

export interface RepositoryKnowledgeReviewDecision {
  classification: "implementation_only" | "canonical_change_candidate" | "needs_review";
}

export interface RepositoryKnowledgeWorkerHost {
  /** The no-capability semantic review; it returns a candidate, never write authority. */
  review(sources: RepositoryKnowledgeReviewSource[]): Promise<RepositoryKnowledgeReviewDecision>;
  /** Read-only knowledge lifecycle check after the review. */
  inspectKnowledge(): Promise<{ current: boolean; snapshotHash: string }>;
}

export type RepositoryKnowledgeTerminalState =
  "current" | "pending_review" | "stale" | "attention_required";

export interface RepositoryKnowledgeJobOutcome {
  changeEventId: string;
  terminalState: RepositoryKnowledgeTerminalState | "retry_scheduled";
  failureCode: string | null;
}

class TerminalOutcome {
  constructor(
    readonly terminalState: RepositoryKnowledgeTerminalState,
    readonly failureCode: string | null,
    readonly classification: RepositoryKnowledgeReviewDecision["classification"] | null = null,
    readonly knowledgeSnapshotHash: string | null = null,
  ) {}
}

function sha256(content: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

async function currentBytes(root: string, path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(resolve(root, path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** The former bytes from recent commits when one of them matches the recorded digest exactly. */
async function beforeBytes(root: string, path: string, digest: string): Promise<Uint8Array | null> {
  for (const revision of ["HEAD", "HEAD~1", "HEAD~2", "HEAD~3"]) {
    try {
      const { stdout } = await run("git", ["cat-file", "blob", `${revision}:${path}`], {
        cwd: root,
        encoding: "buffer",
        maxBuffer: MAXIMUM_REVIEW_BYTES,
      });
      if (sha256(stdout) === digest) return stdout;
    } catch {
      // Absent at this revision or not a Git repository: try the next candidate.
    }
  }
  return null;
}

function text(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function reviewSources(
  root: string,
  manifest: { paths: { path: string; before: string | null; after: string | null }[] },
): Promise<RepositoryKnowledgeReviewSource[]> {
  let bytes = 0;
  const sources: RepositoryKnowledgeReviewSource[] = [];
  for (const entry of manifest.paths) {
    const current = await currentBytes(root, entry.path);
    if ((current === null ? null : sha256(current)) !== entry.after)
      throw new TerminalOutcome("stale", "source_bytes_changed");
    const former = entry.before === null ? null : await beforeBytes(root, entry.path, entry.before);
    const afterText = current === null ? null : text(current);
    const beforeText = former === null ? null : text(former);
    if ((current !== null && afterText === null) || (former !== null && beforeText === null))
      throw new TerminalOutcome("attention_required", "review_source_encoding_unsupported");
    bytes += (current?.byteLength ?? 0) + (former?.byteLength ?? 0);
    if (bytes > MAXIMUM_REVIEW_BYTES)
      throw new TerminalOutcome("attention_required", "review_source_limit_exceeded");
    sources.push({
      path: entry.path,
      before:
        entry.before === null
          ? { kind: "missing" }
          : beforeText === null
            ? { kind: "unavailable" }
            : { kind: "text", text: beforeText },
      after: afterText === null ? { kind: "missing" } : { kind: "text", text: afterText },
    });
  }
  return sources;
}

async function readManifest(artifacts: ArtifactStore, reference: { contentHash: string }) {
  const uri = `lervo-cas://sha256/${reference.contentHash.slice(7)}`;
  if (!(await artifacts.has(uri)))
    throw new TerminalOutcome("attention_required", "knowledge_job_source_unavailable");
  const bytes = await artifacts.get(uri);
  if (sha256(bytes) !== reference.contentHash)
    throw new TerminalOutcome("attention_required", "knowledge_job_source_invalid");
  const manifest = JSON.parse(Buffer.from(bytes).toString("utf8")) as {
    kind?: unknown;
    paths?: { path: string; before: string | null; after: string | null }[];
  };
  if (manifest.kind !== "repository.change.source_manifest" || !Array.isArray(manifest.paths))
    throw new TerminalOutcome("attention_required", "knowledge_job_source_invalid");
  return { paths: manifest.paths };
}

async function resolveJob(
  root: string,
  delivery: OutboxDelivery,
  artifacts: ArtifactStore,
  host: RepositoryKnowledgeWorkerHost,
): Promise<TerminalOutcome> {
  const payload = delivery.event.payload as {
    changedPathCount: number;
    sourceManifest: { contentHash: string };
  };
  if (delivery.event.type !== "repository.change.completed")
    return new TerminalOutcome("attention_required", "knowledge_job_source_invalid");
  if (payload.changedPathCount > MAXIMUM_REPOSITORY_CHANGE_PUBLISHED_PATHS)
    return new TerminalOutcome("attention_required", "repository_change_path_limit_exceeded");
  try {
    const manifest = await readManifest(artifacts, payload.sourceManifest);
    const sources = await reviewSources(root, manifest);
    const decision = await host.review(sources);
    if (decision.classification === "canonical_change_candidate")
      return new TerminalOutcome("pending_review", null, decision.classification);
    if (decision.classification === "needs_review")
      return new TerminalOutcome("attention_required", "review_needs_attention", "needs_review");
    // Unreconstructable former bytes cannot support a knowledge-currency claim.
    if (sources.some((source) => source.before.kind === "unavailable"))
      return new TerminalOutcome(
        "attention_required",
        "before_bytes_unavailable",
        decision.classification,
      );
    const knowledge = await host.inspectKnowledge();
    if (!knowledge.current)
      return new TerminalOutcome(
        "attention_required",
        "knowledge_lifecycle_pending",
        decision.classification,
      );
    return new TerminalOutcome("current", null, decision.classification, knowledge.snapshotHash);
  } catch (error) {
    if (error instanceof TerminalOutcome) return error;
    throw error;
  }
}

function settle(
  events: OutboxStore,
  delivery: OutboxDelivery,
  workerId: string,
  outcome: TerminalOutcome,
  resolvedAt: string,
): void {
  const change = delivery.event;
  events.transact((transaction) => {
    transaction.append({
      eventId: `evt_${sha256(`repository.knowledge.resolved\0${change.eventId}`).slice(7, 39)}`,
      projectId: change.projectId,
      runId: change.runId,
      sessionId: change.sessionId,
      occurredAt: resolvedAt,
      actor: { kind: "system" },
      schemaVersion: 3,
      policyVersion: change.policyVersion,
      type: "repository.knowledge.resolved",
      payload: {
        changeEventId: change.eventId,
        changeEventHash: change.eventHash,
        sourceKind: (change.payload as { sourceKind: RepositoryChangeSourceKind }).sourceKind,
        terminalState: outcome.terminalState,
        classification: outcome.classification,
        attemptCount: Math.min(delivery.attemptCount, MAXIMUM_ATTEMPTS),
        failureCode: outcome.failureCode,
        knowledgeSnapshotHash: outcome.knowledgeSnapshotHash,
        resolvedAt,
      },
    });
    // The outcome and the acknowledgement share one commit; a lost lease rolls both back.
    if (
      !transaction.acknowledge({
        eventId: change.eventId,
        destinationId: REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
        workerId,
        acknowledgedAt: resolvedAt,
      }).acknowledged
    )
      throw new Error("The repository knowledge job lease was lost before settlement.");
  });
}

/**
 * Settles up to `maximumJobs` queued repository knowledge jobs. A transient host failure is
 * rescheduled with backoff, and the sixteenth attempt settles as retry-exhausted attention.
 */
export async function processRepositoryKnowledgeJobs(input: {
  repositoryRoot: string;
  events: OutboxStore;
  artifacts: ArtifactStore;
  workerId: string;
  host: RepositoryKnowledgeWorkerHost;
  now?: () => Date;
  maximumJobs?: number;
  leaseDurationMs?: number;
}): Promise<RepositoryKnowledgeJobOutcome[]> {
  const now = input.now ?? (() => new Date());
  const outcomes: RepositoryKnowledgeJobOutcome[] = [];
  for (let index = 0; index < (input.maximumJobs ?? 8); index++) {
    const [delivery] = input.events.transact((transaction) =>
      transaction.claim({
        workerId: input.workerId,
        claimedAt: now().toISOString(),
        leaseDurationMs: input.leaseDurationMs ?? DEFAULT_LEASE_MS,
        destinationId: REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
        limit: 1,
      }),
    );
    if (delivery === undefined) break;
    let outcome: TerminalOutcome;
    try {
      outcome = await resolveJob(input.repositoryRoot, delivery, input.artifacts, input.host);
    } catch (error) {
      if (delivery.attemptCount < MAXIMUM_ATTEMPTS) {
        const failedAt = now();
        const delayMs = Math.min(60 * 60_000, 60_000 * 2 ** (delivery.attemptCount - 1));
        input.events.transact((transaction) =>
          transaction.reschedule({
            eventId: delivery.event.eventId,
            destinationId: REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
            workerId: input.workerId,
            failedAt: failedAt.toISOString(),
            availableAt: new Date(failedAt.getTime() + delayMs).toISOString(),
            failureCode: "knowledge_job_transient_failure",
          }),
        );
        outcomes.push({
          changeEventId: delivery.event.eventId,
          terminalState: "retry_scheduled",
          failureCode: error instanceof Error ? error.name : "unknown",
        });
        continue;
      }
      outcome = new TerminalOutcome("attention_required", "knowledge_retry_exhausted");
    }
    settle(input.events, delivery, input.workerId, outcome, now().toISOString());
    outcomes.push({
      changeEventId: delivery.event.eventId,
      terminalState: outcome.terminalState,
      failureCode: outcome.failureCode,
    });
  }
  return outcomes;
}
