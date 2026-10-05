import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  admitDocumentFreshnessFindings,
  canonicalJson,
  documentFreshnessAutoApplicableHunks,
  documentFreshnessFindingsDigest,
  documentFreshnessOwnershipResolver,
  documentFreshnessPolicy,
  documentFreshnessPriorityClass,
  documentFreshnessReviewStates,
  loadRepositoryKnowledgePolicy,
  observeDocumentFreshnessFindings,
  orderDocumentFreshnessFindings,
  sha256,
  stableId,
  type DocumentFreshnessCandidateV1,
  type DocumentFreshnessSummary,
  type PrioritizedDocumentFreshnessFinding,
} from "@lervo/repository-knowledge";

import { committedBlob } from "./freshness-commit.js";
import { applyLervoManagedFreshnessHunks, supersedeFreshnessCandidate } from "./freshness-apply.js";
import { DocumentFreshnessOperationError } from "./freshness-document-io.js";
import { generateFreshnessCandidate } from "./freshness-candidate-generation.js";
import { appendFreshnessEvent, FRESHNESS_EVENT_SCHEMA_VERSION } from "./freshness-events.js";
import type { FreshnessGenerationContext } from "./freshness-generation.js";
import {
  listFreshnessCandidates,
  listFreshnessHolds,
  pruneFreshnessState,
  readFreshnessCycleState,
  writeFreshnessCycleState,
  type FreshnessCycleState,
} from "./freshness-state-store.js";

const execute = promisify(execFile);
const ZERO_SUCCESS_ATTEMPTS = 5;
const RECENT_APPLY_MILLISECONDS = 24 * 3_600_000;
const MAXIMUM_FIRST_SEEN = 512;

export type DocumentFreshnessCycleResult =
  | { status: "disabled" | "unavailable" | "unchanged" }
  | {
      status: "completed";
      cycleId: string;
      findingCount: number;
      admittedCount: number;
      candidateCount: number;
      verifiedCount: number;
      appliedCount: number;
      deferred: string | null;
    };

async function observationKey(root: string, input: unknown): Promise<string | null> {
  try {
    const [head, status] = await Promise.all(
      [
        ["rev-parse", "HEAD"],
        ["status", "--porcelain=v2", "-z", "--untracked-files=all"],
      ].map(
        async (args) =>
          (
            await execute("git", ["--no-optional-locks", "-C", root, ...args], {
              maxBuffer: 64 * 1024 * 1024,
            })
          ).stdout,
      ),
    );
    return sha256(canonicalJson({ head: head!.trim(), status: sha256(status!), input }));
  } catch {
    return null;
  }
}

async function workingBytes(root: string, path: string): Promise<Buffer | null> {
  try {
    const stat = await lstat(resolve(root, path));
    return stat.isFile() ? await readFile(resolve(root, path)) : null;
  } catch {
    return null;
  }
}

function summarize(input: {
  findings: readonly PrioritizedDocumentFreshnessFinding[];
  candidates: readonly DocumentFreshnessCandidateV1[];
  blocked: boolean;
  now: Date;
}): DocumentFreshnessSummary {
  const safety = input.findings.filter((entry) => entry.priorityClass === "safety");
  return {
    staleCount: input.findings.length,
    safetyCount: safety.length,
    firstSafetyPath: safety[0]?.finding.documentPath ?? null,
    awaitingReviewCount: input.candidates.filter((candidate) =>
      documentFreshnessReviewStates.has(candidate.state),
    ).length,
    appliedRecentPaths: input.candidates
      .filter(
        (candidate) =>
          (candidate.state === "applied" || candidate.state === "partially_applied") &&
          input.now.getTime() - Date.parse(candidate.updatedAt) < RECENT_APPLY_MILLISECONDS &&
          candidate.acknowledgedAt === null,
      )
      .map((candidate) => candidate.documentPath)
      .slice(0, 8),
    blocked: input.blocked,
  };
}

/**
 * Supersedes open candidates whose document bytes moved under them (F5): an owner edit during
 * review always wins, and the next observation produces a fresh candidate from the new bytes.
 */
async function supersedeMovedCandidates(
  context: FreshnessGenerationContext,
  candidates: DocumentFreshnessCandidateV1[],
): Promise<DocumentFreshnessCandidateV1[]> {
  const root = context.storage.paths.repositoryRoot;
  const result: DocumentFreshnessCandidateV1[] = [];
  for (const candidate of candidates) {
    if (!documentFreshnessReviewStates.has(candidate.state) || candidate.operation === "archive") {
      result.push(candidate);
      continue;
    }
    const bytes = await workingBytes(root, candidate.documentPath);
    const expected = candidate.appliedHash ?? candidate.sourceHash;
    result.push(
      bytes !== null && sha256(bytes) === expected
        ? candidate
        : await supersedeFreshnessCandidate({
            storage: context.storage,
            candidate,
            now: context.now(),
          }),
    );
  }
  return result;
}

/** A crash between verification and apply leaves `verified` edits; Lervo finishes its own part. */
async function resumeVerifiedCandidates(
  context: FreshnessGenerationContext,
  candidates: readonly DocumentFreshnessCandidateV1[],
): Promise<void> {
  for (const candidate of candidates) {
    if (candidate.state !== "verified" || candidate.operation !== "edit") continue;
    const automatic = documentFreshnessAutoApplicableHunks(candidate);
    if (automatic.length === 0) continue;
    try {
      await applyLervoManagedFreshnessHunks({
        storage: context.storage,
        candidate,
        hunkIds: new Set(automatic.map((hunk) => hunk.hunkId)),
        now: context.now(),
      });
    } catch (error) {
      if (!(error instanceof DocumentFreshnessOperationError)) throw error;
    }
  }
}

/**
 * The ADR-0463 freshness stage of the knowledge resident. It runs only when its fence changed,
 * admits findings by priority and budget, generates and verifies candidates through the governed
 * provider path, applies Lervo's own verified hunks, and holds everything else for the owner.
 */
export async function runDocumentFreshnessCycle(input: {
  context: FreshnessGenerationContext;
  /** Decision kinds of the installed principal mandate; version 1 installs none. */
  mandateKinds?: readonly string[];
}): Promise<DocumentFreshnessCycleResult> {
  const { context } = input;
  const storage = context.storage;
  const root = storage.paths.repositoryRoot;
  const policy = documentFreshnessPolicy(await loadRepositoryKnowledgePolicy(root));
  if (!policy.enabled) return { status: "disabled" };
  if ((storage.writableEventSchemaVersion ?? 1) < FRESHNESS_EVENT_SCHEMA_VERSION)
    return { status: "unavailable" };
  const now = context.now();
  const day = now.toISOString().slice(0, 10);
  const state: FreshnessCycleState = await readFreshnessCycleState(root);
  if (state.budget.day !== day) state.budget = { day, tokensUsed: 0, attempts: 0, verified: 0 };
  const holds = await listFreshnessHolds(root);
  let candidates = await listFreshnessCandidates(root);
  const key = await observationKey(root, {
    policy,
    day,
    holds: holds.map((hold) => [hold.findingDigest, hold.until]),
    candidates: candidates.map((candidate) => [
      candidate.candidateId,
      candidate.state,
      candidate.updatedAt,
    ]),
  });
  if (key !== null && key === state.observationKey) return { status: "unchanged" };
  await pruneFreshnessState(root, now);
  candidates = await supersedeMovedCandidates(context, await listFreshnessCandidates(root));
  await resumeVerifiedCandidates(context, candidates);
  candidates = await listFreshnessCandidates(root);
  let observation: Awaited<ReturnType<typeof observeDocumentFreshnessFindings>>;
  try {
    observation = await observeDocumentFreshnessFindings({ repositoryRoot: root, now });
  } catch {
    // A pending materialization transaction or unreadable policy defers freshness to a later cycle.
    return { status: "unavailable" };
  }
  if (observation.status !== "observed") return { status: "unavailable" };
  const ownershipOf = await documentFreshnessOwnershipResolver(root);
  const firstSeen: Record<string, string> = {};
  const contents = new Map<string, Buffer>();
  const prioritized: PrioritizedDocumentFreshnessFinding[] = [];
  for (const finding of observation.findings) {
    const bytes = await workingBytes(root, finding.documentPath);
    const committed = await committedBlob(root, finding.documentPath);
    // Uncommitted edits belong to whoever is editing; the document waits until they settle.
    if (bytes === null || committed === null || !bytes.equals(committed)) continue;
    firstSeen[finding.findingDigest] = state.firstSeen[finding.findingDigest] ?? now.toISOString();
    const timed = { ...finding, detectedAt: firstSeen[finding.findingDigest]! };
    contents.set(finding.documentPath, bytes);
    prioritized.push({
      finding: timed,
      priorityClass: documentFreshnessPriorityClass({
        finding: timed,
        content: bytes.toString("utf8"),
        policy,
      }),
    });
  }
  const ordered = orderDocumentFreshnessFindings(prioritized);
  const admission = admitDocumentFreshnessFindings({
    ordered,
    candidates,
    holds,
    tokensUsedToday: state.budget.tokensUsed,
    policy,
    now,
  });
  let candidateCount = 0;
  let verifiedCount = 0;
  let appliedCount = 0;
  let tokensObserved = 0;
  let deferred: string | null = null;
  for (const entry of admission.admitted) {
    const attempt = candidates.filter(
      (candidate) => candidate.findingDigest === entry.finding.findingDigest,
    ).length;
    let outcome: Awaited<ReturnType<typeof generateFreshnessCandidate>>;
    try {
      outcome = await generateFreshnessCandidate({
        context,
        entry,
        content: contents.get(entry.finding.documentPath)!,
        documentOwnership: ownershipOf(entry.finding.documentPath),
        attempt,
        policy,
        mandateKinds: input.mandateKinds ?? [],
      });
    } catch (error) {
      if (error instanceof DocumentFreshnessOperationError) continue;
      throw error;
    }
    if (outcome.status === "deferred") {
      deferred = outcome.reason;
      break;
    }
    candidateCount += 1;
    tokensObserved += outcome.tokensObserved;
    state.budget.tokensUsed += outcome.tokensObserved;
    state.budget.attempts += 1;
    if (outcome.candidate.state !== "rejected") {
      verifiedCount += 1;
      state.budget.verified += 1;
    }
    if (outcome.candidate.state === "applied" || outcome.candidate.state === "partially_applied")
      appliedCount += 1;
  }
  const findingsDigest = documentFreshnessFindingsDigest(observation.findings);
  const blocked = state.budget.attempts >= ZERO_SUCCESS_ATTEMPTS && state.budget.verified === 0;
  const finalCandidates = await listFreshnessCandidates(root);
  const cycleId = stableId("kfcy", { key, findingsDigest, at: now.toISOString() });
  const next: FreshnessCycleState = {
    schemaVersion: 1,
    observationKey: null,
    findingsDigest,
    firstSeen: Object.fromEntries(Object.entries(firstSeen).slice(0, MAXIMUM_FIRST_SEEN)),
    budget: state.budget,
    summary: summarize({ findings: ordered, candidates: finalCandidates, blocked, now }),
    lastCycleAt: now.toISOString(),
  };
  appendFreshnessEvent({
    storage,
    type: "document.freshness.cycle.completed",
    correlationId: cycleId,
    coordinate: null,
    occurredAt: now.toISOString(),
    payload: {
      cycleId,
      findingCount: observation.findings.length,
      admittedCount: admission.admitted.length,
      candidateCount,
      verifiedCount,
      appliedCount,
      skippedForBudget: admission.skippedForBudget,
      skippedForHold: admission.skippedForHold,
      usageObserved: tokensObserved,
      occurredAt: now.toISOString(),
    },
  });
  // The fence is recorded after this cycle's own writes, so only a later change runs the stage.
  // A deferred call or findings left by the per-cycle count keep the stage running next cycle.
  next.observationKey =
    deferred === null && admission.skippedForCycleLimit === 0
      ? await observationKey(root, {
          policy,
          day,
          holds: (await listFreshnessHolds(root)).map((hold) => [hold.findingDigest, hold.until]),
          candidates: finalCandidates.map((candidate) => [
            candidate.candidateId,
            candidate.state,
            candidate.updatedAt,
          ]),
        })
      : null;
  await writeFreshnessCycleState(root, next);
  return {
    status: "completed",
    cycleId,
    findingCount: observation.findings.length,
    admittedCount: admission.admitted.length,
    candidateCount,
    verifiedCount,
    appliedCount,
    deferred,
  };
}
