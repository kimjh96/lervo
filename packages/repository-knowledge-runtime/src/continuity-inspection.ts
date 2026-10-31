import {
  continuityFindings,
  localContinuityFindings,
  type ContinuityDelegationObservation,
  type ContinuityFinding,
} from "./continuity-findings.js";
import {
  readConvergenceContinuityPolicy,
  type ConvergenceContinuityPolicyReading,
} from "./continuity-policy-store.js";
import {
  readConvergenceContinuityState,
  type ConvergenceContinuityState,
} from "./continuity-state.js";
import { readConvergenceOwnerFence } from "./convergence-owner-fence.js";
import type { ConvergenceOwnerVerdict } from "./convergence-owner-verdict.js";
import { loadConvergenceDelegation } from "./delegation.js";
import { decideDelegationRenewal } from "./delegation-continuity-decision.js";
import { readKnowledgePublicationState } from "./knowledge-publication-state.js";
import { inspectKnowledgeResidentHealth, type KnowledgeResidentHealth } from "./resident-health.js";
import { observeResidentHost, type ResidentHostObservation } from "./resident-host-observation.js";

export interface ConvergenceContinuityInspection {
  delegation: ContinuityDelegationObservation;
  policy: ConvergenceContinuityPolicyReading;
  state: ConvergenceContinuityState | null;
  verdict: ConvergenceOwnerVerdict | null;
  publicationStatus: string | null;
  resident: KnowledgeResidentHealth | null;
  findings: ContinuityFinding[];
}

/**
 * Read-only ADR-0469 inspection of one checkout without contacting the Hub. Delegation, policy,
 * lease, and publication facts are read live; owner-host, Hub, and peer facts come from the last
 * resident reconciliation. Callers add what only they can observe, such as hook freshness.
 */
export async function inspectConvergenceContinuity(input: {
  repositoryRoot: string;
  policyPath: string | null;
  now?: Date;
  hookRuntime?: "current" | "stale" | "unknown";
  replicaDiverged?: boolean;
  /** ADR-0470: which host runs the resident; observed from the fleet and host status if absent. */
  residentHost?: ResidentHostObservation | null;
}): Promise<ConvergenceContinuityInspection> {
  const now = (input.now ?? new Date()).getTime();
  const root = input.repositoryRoot;
  let delegation: ContinuityDelegationObservation;
  let renewal: ReturnType<typeof decideDelegationRenewal> | null = null;
  const policy: ConvergenceContinuityPolicyReading =
    input.policyPath === null
      ? { status: "absent" }
      : await readConvergenceContinuityPolicy(input.policyPath);
  try {
    const loaded = (await loadConvergenceDelegation(root))?.delegation ?? null;
    if (loaded === null) delegation = { state: "missing" };
    else {
      delegation =
        loaded.state === "revoked"
          ? { state: "revoked", expiresAt: loaded.expiresAt }
          : Date.parse(loaded.expiresAt) <= now
            ? { state: "expired", expiresAt: loaded.expiresAt }
            : { state: "active", expiresAt: loaded.expiresAt };
      renewal = decideDelegationRenewal({ delegation: loaded, policy, now });
    }
  } catch {
    delegation = { state: "invalid" };
  }
  const [state, fence, publication, resident, residentHost] = await Promise.all([
    readConvergenceContinuityState(root),
    readConvergenceOwnerFence(root),
    readKnowledgePublicationState(root).catch(() => null),
    inspectKnowledgeResidentHealth(root, new Date(now)).catch(() => null),
    input.residentHost !== undefined
      ? Promise.resolve(input.residentHost)
      : observeResidentHost(root, new Date(now)).catch(() => null),
  ]);
  const policyActive = policy.status === "loaded" && policy.policy.state === "active";
  const expected = delegation.state !== "missing" || policyActive;
  const findings = [
    ...continuityFindings({
      scopeChange: state?.scopeChange ?? null,
      scopeResponse: state?.scopeResponse ?? null,
      now,
      delegation,
      policy,
      renewal,
      continuationFailure: state?.continuationFailure?.code ?? null,
      ownerHost: state?.ownerHost ?? null,
      verdict:
        fence === null
          ? null
          : { role: fence.verdict.role, failureCode: fence.verdict.failureCode ?? null },
      publicationStatus: publication?.status ?? null,
      hubFailure: state?.hub.failureCode ?? null,
      peers: state?.peers ?? [],
    }),
    ...localContinuityFindings({
      now,
      expected,
      stateObservedAt: state?.observedAt ?? null,
      residentRunning: resident === null ? null : resident.status !== "not_running",
      hookRuntime: input.hookRuntime ?? "unknown",
      replicaDiverged: input.replicaDiverged ?? false,
      residentHold: resident?.status === "degraded" ? resident.reason : null,
      residentHost,
      owner: fence?.verdict.role === "owner",
    }),
  ];
  return {
    delegation,
    policy,
    state,
    verdict: fence?.verdict ?? null,
    publicationStatus: publication?.status ?? null,
    resident,
    findings,
  };
}
