// ADR-0660: why the resident's last retention-only attempt ran no slice. Attention reads it beside
// the observation, so retention that keeps waiting is named long before the observation is stale.
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import { CAS_RETENTION_WAIT } from "./cas-retention-files.js";
import { writeRetentionProjection } from "./cas-retention-state.js";

/**
 * - `live_work`: a developer lease was current.
 * - `admission_busy`: full knowledge cycles held or waited for the host admission.
 * - `retention_turn`: other repositories' retention turns, or the host's pause, came first.
 */
export type CasRetentionWaitCause = "live_work" | "admission_busy" | "retention_turn";

export interface CasRetentionWait {
  cause: CasRetentionWaitCause;
  at: number;
  /** With `retention_turn`: when the host's turn is expected, which the request holds. */
  retryAt?: number;
}

/**
 * Records the cause, or clears it once a slice ran; a failed write loses only this detail. A
 * deferred turn also records when to come back, so the resident returns for it after a full
 * cycle whose retention was deferred.
 */
export async function recordRetentionWait(
  knowledgeState: string,
  cause: CasRetentionWaitCause | null,
  at: number,
  retryAt?: number,
): Promise<void> {
  try {
    const path = resolve(knowledgeState, CAS_RETENTION_WAIT);
    if (cause === null) await rm(path, { force: true });
    else
      await writeRetentionProjection(path, {
        schemaVersion: 1,
        cause,
        at: new Date(at).toISOString(),
        ...(retryAt === undefined ? {} : { retryAt: new Date(retryAt).toISOString() }),
      });
  } catch {
    // Attention then names the cause as unknown.
  }
}

/** The recorded wait, or null when none is recorded or it cannot be read. */
export function readRetentionWait(knowledgeState: string): CasRetentionWait | null {
  try {
    const wait = JSON.parse(readFileSync(resolve(knowledgeState, CAS_RETENTION_WAIT), "utf8")) as {
      cause?: unknown;
      at?: unknown;
      retryAt?: unknown;
    };
    const at = Date.parse(String(wait.at));
    const retryAt = Date.parse(String(wait.retryAt));
    if (
      !["live_work", "admission_busy", "retention_turn"].includes(String(wait.cause)) ||
      !Number.isFinite(at)
    )
      return null;
    return {
      cause: wait.cause as CasRetentionWaitCause,
      at,
      ...(Number.isFinite(retryAt) ? { retryAt } : {}),
    };
  } catch {
    return null;
  }
}
