import type { ProviderCliAdmissionProjection } from "@lervo/sync-contract";
import { resolve } from "node:path";

import type {
  ContinuityFinding,
  ContinuityOwnerHostObservation,
  ContinuityPeerObservation,
} from "./continuity-findings.js";
import { readPrivateJsonFile, writePrivateJsonFile } from "./private-state-file.js";

/**
 * ADR-0469 host-local continuity projection, rewritten after every reconciliation. It is
 * rebuildable: losing it costs one reconciliation. Attention and the doctor read it instead of
 * contacting the Hub. It holds hashes, closed codes, labels, and timestamps.
 */
export const CONVERGENCE_CONTINUITY_STATE_PATH =
  ".lervo/state/knowledge/convergence-continuity.json";

export interface ContinuityPeerSummary extends ContinuityPeerObservation {
  hostHash: string;
  ownerRole: string | null;
  residentState: string | null;
  providerAdmission?: ProviderCliAdmissionProjection;
}

export interface ConvergenceContinuityState {
  schemaVersion: 1;
  observedAt: string;
  /** ADR-0602: continuity's own next time-based deadline; null when only a change is due. */
  nextReconcileAt: string | null;
  /** ADR-0602: the host-local inputs this reconciliation read; absent before ADR-0602. */
  inputFingerprint?: string;
  /** ADR-0602: consecutive failed reconciliations, for the retry backoff. */
  failureStreak?: number;
  hostHash: string | null;
  hostLabel: string | null;
  ownerHost: ContinuityOwnerHostObservation;
  delegation: { state: string; expiresAt: string | null; scopeHash: string | null };
  policy: { state: string; horizonAt: string | null; authority: string | null };
  lastContinuation: {
    action: "renewed" | "seeded" | "rebound" | "adopted";
    source: "renewal" | "peer" | "policy_template" | "binding_refresh" | "owner";
    planHash: string;
    expiresAt: string;
    at: string;
  } | null;
  continuationFailure: {
    code: string;
    firstObservedAt: string;
    lastObservedAt: string;
    occurrences: number;
  } | null;
  hub: { status: "ok" | "unavailable" | "not_configured"; failureCode: string | null };
  peers: ContinuityPeerSummary[];
  findings: ContinuityFinding[];
  providerAdmission?: ProviderCliAdmissionProjection;
}

const MAXIMUM_STATE_BYTES = 16 * 1024 * 1024;

async function readRecordedContinuityState(
  root: string,
): Promise<Partial<ConvergenceContinuityState> | null> {
  const file = await readPrivateJsonFile(
    resolve(root, CONVERGENCE_CONTINUITY_STATE_PATH),
    MAXIMUM_STATE_BYTES,
  );
  return file.status === "read" ? (file.value as Partial<ConvergenceContinuityState> | null) : null;
}

/**
 * Older versions recorded a delegation scope proposal and `owner_decision` findings. ADR-0561
 * retired both: the scope proposal and its finding are dropped, and an `owner_decision` finding
 * reads as `lervo_debt`, so no stored projection asks the owner for anything.
 */
function currentFinding(finding: ContinuityFinding): ContinuityFinding | null {
  const code: string = finding.code;
  if (code === "delegation_scope_change") return null;
  const severity: string = finding.severity;
  return severity === "owner_decision" ? { ...finding, severity: "lervo_debt" } : finding;
}

export async function readConvergenceContinuityState(
  root: string,
): Promise<ConvergenceContinuityState | null> {
  const value = await readRecordedContinuityState(root);
  if (
    value?.schemaVersion !== 1 ||
    typeof value.observedAt !== "string" ||
    !(value.nextReconcileAt === null || typeof value.nextReconcileAt === "string") ||
    !Array.isArray(value.findings) ||
    !Array.isArray(value.peers)
  )
    return null;
  const {
    scopeChange: _scopeChange,
    scopeResponse: _scopeResponse,
    ...state
  } = value as ConvergenceContinuityState & { scopeChange?: unknown; scopeResponse?: unknown };
  return {
    ...state,
    findings: value.findings.flatMap((finding) => currentFinding(finding) ?? []),
  };
}

export async function writeConvergenceContinuityState(
  root: string,
  state: ConvergenceContinuityState,
): Promise<void> {
  await writePrivateJsonFile(resolve(root, CONVERGENCE_CONTINUITY_STATE_PATH), {
    ...state,
    peers: state.peers.slice(0, 8),
    findings: state.findings.slice(0, 32),
  });
}

/** Repeats of one failure code update a single record. */
export function nextContinuationFailure(
  previous: ConvergenceContinuityState["continuationFailure"],
  code: string | null,
  observedAt: string,
): ConvergenceContinuityState["continuationFailure"] {
  if (code === null) return null;
  if (previous?.code === code)
    return {
      ...previous,
      lastObservedAt: observedAt,
      occurrences: Math.min(previous.occurrences + 1, 1_000_000),
    };
  return { code, firstObservedAt: observedAt, lastObservedAt: observedAt, occurrences: 1 };
}
