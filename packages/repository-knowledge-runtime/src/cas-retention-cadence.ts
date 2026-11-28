// ADR-0660: while a retention pass leaves work, the resident runs the next slice soon, even when
// nothing else would wake it. Retention needs no provider, so a provider wait never holds it back.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CAS_RETENTION_OBSERVATION } from "./cas-retention-files.js";

/** The pause between two retention slices while work remains. */
export const CAS_RETENTION_CONTINUE_MILLISECONDS = 30_000;

const KNOWLEDGE_STATE = ".lervo/state/knowledge";

/** When the last recorded pass ran, if it left work; null when it left none or is unreadable. */
function pendingPassAt(repositoryRoot: string): number | null {
  try {
    const observation = JSON.parse(
      readFileSync(resolve(repositoryRoot, KNOWLEDGE_STATE, CAS_RETENTION_OBSERVATION), "utf8"),
    ) as { observedAt?: unknown; status?: unknown; remaining?: unknown };
    if (observation.remaining !== true || observation.status === "unavailable") return null;
    const at = Date.parse(typeof observation.observedAt === "string" ? observation.observedAt : "");
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

/**
 * The change fence's due time for retention. Once it passes, the fence cannot skip the cycle, so
 * the next one runs a slice even though nothing else changed.
 */
export function casRetentionWakeAt(repositoryRoot: string): number | null {
  const at = pendingPassAt(repositoryRoot);
  return at === null ? null : at + CAS_RETENTION_CONTINUE_MILLISECONDS;
}

/**
 * After a full cycle whose own pass left work, the next slice is due a pause after the cycle
 * ended, however long its other stages took. A pass the cycle did not run, such as on a held or
 * off-base checkout, asks for nothing, so a stale observation can never loop the resident.
 */
export function casRetentionContinueAt(
  repositoryRoot: string,
  cycleStartedAt: number,
  finishedAt: number,
): number | null {
  const at = pendingPassAt(repositoryRoot);
  return at === null || at < cycleStartedAt
    ? null
    : finishedAt + CAS_RETENTION_CONTINUE_MILLISECONDS;
}
