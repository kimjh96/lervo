import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  canonicalJson,
  sha256,
  documentFreshnessHeldStates,
  type DocumentFreshnessCandidateV1,
  type DocumentFreshnessDebt,
  type DocumentFreshnessSummary,
  type PrioritizedDocumentFreshnessFinding,
} from "@lervo/repository-knowledge";

import type { FreshnessCycleState } from "./freshness-state-store.js";

const execute = promisify(execFile);
const RECENT_APPLY_MILLISECONDS = 24 * 3_600_000;
export async function observationKey(root: string, input: unknown): Promise<string | null> {
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

export async function workingBytes(root: string, path: string): Promise<Buffer | null> {
  try {
    const stat = await lstat(resolve(root, path));
    return stat.isFile() ? await readFile(resolve(root, path)) : null;
  } catch {
    return null;
  }
}

const MAXIMUM_SUMMARY_DEBT = 8;

/** The oldest Lervo debt entries the owner surfaces render, with no candidate identifiers. */
export function freshnessDebtSummary(
  debt: readonly DocumentFreshnessDebt[],
): NonNullable<DocumentFreshnessSummary["debt"]> {
  return debt.slice(0, MAXIMUM_SUMMARY_DEBT).map((entry) => ({
    documentPath: entry.documentPath,
    reason: entry.reason,
    since: entry.since,
  }));
}

export function summarize(input: {
  findings: readonly PrioritizedDocumentFreshnessFinding[];
  candidates: readonly DocumentFreshnessCandidateV1[];
  blocked: boolean;
  debt: readonly DocumentFreshnessDebt[];
  now: Date;
}): DocumentFreshnessSummary {
  const safety = input.findings.filter((entry) => entry.priorityClass === "safety");
  return {
    staleCount: input.findings.length,
    safetyCount: safety.length,
    firstSafetyPath: safety[0]?.finding.documentPath ?? null,
    awaitingReviewCount: input.candidates.filter((candidate) =>
      documentFreshnessHeldStates.has(candidate.state),
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
    debt: freshnessDebtSummary(input.debt),
  };
}

/**
 * ADR-0598: what a cycle event reports, without the cycle identity and time. Two cycles with the
 * same digest told the event log the same thing.
 */
export function freshnessOutcomeDigest(payload: Record<string, unknown>): string {
  const { cycleId: _cycleId, occurredAt: _occurredAt, ...outcome } = payload;
  return sha256(canonicalJson(outcome));
}

/**
 * ADR-0598 generalizes ADR-0580: a cycle that admitted, generated, verified, applied, and spent
 * nothing over the same findings records an event only when its outcome differs from the last
 * recorded one. Otherwise the event would only move the head, and a stage reopened by a debt it
 * cannot afford would append the same event every cycle.
 */
export function freshnessCycleNewsworthy(input: {
  previous: Pick<FreshnessCycleState, "findingsDigest" | "lastOutcomeDigest">;
  findingsDigest: string | null;
  outcomeDigest: string;
  outcome: Parameters<typeof deferredWithoutProgress>[0] & { admittedCount: number };
}): boolean {
  if (input.findingsDigest !== input.previous.findingsDigest) return true;
  if (deferredWithoutProgress(input.outcome)) return false;
  const progress =
    input.outcome.admittedCount > 0 ||
    input.outcome.candidateCount > 0 ||
    input.outcome.verifiedCount > 0 ||
    input.outcome.appliedCount > 0 ||
    input.outcome.tokensObserved > 0;
  return progress || input.outcomeDigest !== (input.previous.lastOutcomeDigest ?? null);
}

/**
 * ADR-0580: a deferral that spent, generated, verified, and applied nothing has no news to record.
 * Its cycle event would only move the event head, waking the resident and changing its fence, so
 * a deferral repeated while the owner works or a provider is paused became a loop.
 */
export function deferredWithoutProgress(outcome: {
  deferred: string | null;
  candidateCount: number;
  verifiedCount: number;
  appliedCount: number;
  tokensObserved: number;
}): boolean {
  return (
    outcome.deferred !== null &&
    outcome.candidateCount === 0 &&
    outcome.verifiedCount === 0 &&
    outcome.appliedCount === 0 &&
    outcome.tokensObserved === 0
  );
}
