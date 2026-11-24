import type { ProjectStorage } from "@lervo/project-storage";
import {
  replayKnowledgeConvergence,
  VERIFICATION_FAILURE_CODES,
  type KnowledgeConvergenceStatus,
} from "@lervo/repository-knowledge";

import { readEvidenceArtifact } from "./verification-source-changes.js";

export const VERIFICATION_FAILED = "knowledge_verification_failed";
const COMMAND_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const COMMAND_STATUSES = new Set([
  "failed",
  "timed_out",
  "output_limit_exceeded",
  "execution_error",
  "cancelled",
]);

/** The first command of a verification result that did not pass, or null. */
function failedCommand(
  result: Record<string, unknown>,
): NonNullable<KnowledgeConvergenceStatus["verificationFailure"]> | null {
  if (typeof result.suiteId !== "string" || !Array.isArray(result.commands)) return null;
  for (const entry of result.commands) {
    if (typeof entry !== "object" || entry === null) continue;
    const { commandId, status, exitCode, durationMs } = entry as Record<string, unknown>;
    if (typeof commandId !== "string" || !COMMAND_ID.test(commandId)) continue;
    if (typeof status !== "string" || !COMMAND_STATUSES.has(status)) continue;
    return {
      suiteId: COMMAND_ID.test(result.suiteId) ? result.suiteId : "unknown",
      commandId,
      status,
      exitCode: Number.isSafeInteger(exitCode) ? (exitCode as number) : null,
      durationMs:
        Number.isSafeInteger(durationMs) && (durationMs as number) >= 0
          ? (durationMs as number)
          : null,
    };
  }
  return null;
}

/**
 * The first failed command of the suite a stage dependency names: the suite's result itself, or an
 * assignment failure proof that names it one or two levels further. Anything else gives null.
 */
export async function verificationFailureFromEvidence(
  artifacts: ProjectStorage["artifacts"],
  dependencyHash: unknown,
): Promise<NonNullable<KnowledgeConvergenceStatus["verificationFailure"]> | null> {
  let evidence = await readEvidenceArtifact(artifacts, dependencyHash);
  for (let depth = 0; depth < 2 && evidence !== null && evidence.suiteId === undefined; depth++)
    evidence = await readEvidenceArtifact(artifacts, evidence.evidenceHash);
  return evidence === null ? null : failedCommand(evidence);
}

/**
 * ADR-0562 section 3: a verification stop names its cause. The status gains the first command of
 * the failed suite that did not pass, so the health line says what to fix instead of only that
 * verification failed. A command the host could not run or finish names its cause the same way.
 */
export async function withVerificationFailureStatus(
  storage: Pick<ProjectStorage, "artifacts" | "events">,
  status: KnowledgeConvergenceStatus,
): Promise<KnowledgeConvergenceStatus> {
  if (status.reason === null || !VERIFICATION_FAILURE_CODES.has(status.reason)) return status;
  const active = replayKnowledgeConvergence(storage.events).find((row) => row.outcome === null);
  const failure = await verificationFailureFromEvidence(
    storage.artifacts,
    active?.latest?.payload.dependencyHash,
  );
  return failure === null ? status : { ...status, verificationFailure: failure };
}
