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
 * contacting the Hub. It holds hashes, closed codes, labels, and timestamps only.
 */
export const CONVERGENCE_CONTINUITY_STATE_PATH =
  ".lervo/state/knowledge/convergence-continuity.json";

export interface ContinuityPeerSummary extends ContinuityPeerObservation {
  hostHash: string;
  ownerRole: string | null;
  residentState: string | null;
}

export interface ConvergenceContinuityState {
  schemaVersion: 1;
  observedAt: string;
  nextReconcileAt: string;
  hostHash: string | null;
  hostLabel: string | null;
  ownerHost: ContinuityOwnerHostObservation;
  delegation: { state: string; expiresAt: string | null; scopeHash: string | null };
  policy: { state: string; horizonAt: string | null; authority: string | null };
  lastContinuation: {
    action: "renewed" | "seeded" | "rebound";
    source: "renewal" | "peer" | "policy_template" | "binding_refresh";
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
}

const MAXIMUM_STATE_BYTES = 64 * 1024;

export async function readConvergenceContinuityState(
  root: string,
): Promise<ConvergenceContinuityState | null> {
  const file = await readPrivateJsonFile(
    resolve(root, CONVERGENCE_CONTINUITY_STATE_PATH),
    MAXIMUM_STATE_BYTES,
  );
  if (file.status !== "read") return null;
  const value = file.value as Partial<ConvergenceContinuityState> | null;
  return value?.schemaVersion === 1 &&
    typeof value.observedAt === "string" &&
    typeof value.nextReconcileAt === "string" &&
    Array.isArray(value.findings) &&
    Array.isArray(value.peers)
    ? (value as ConvergenceContinuityState)
    : null;
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
