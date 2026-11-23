import type { ProviderCliAdmissionProjection } from "@lervo/sync-contract";
import {
  knowledgeConvergenceScopeHash,
  type KnowledgeConvergenceHostListing,
  type KnowledgeConvergenceHostModelSelection,
  type KnowledgeConvergenceHostRecord,
} from "@lervo/sync-contract";

import type { ContinuityFinding } from "./continuity-findings.js";
import type { ContinuityPeerSummary } from "./continuity-state.js";
import type { ConvergenceOwnerHost } from "./convergence-owner-host.js";
import type { ConvergenceOwnerVerdict } from "./convergence-owner-verdict.js";
import type { ConvergenceDelegation } from "./delegation-contract.js";
import { convergenceDelegationScope } from "./delegation-scope.js";
import type { DelegationContinuityResult } from "./delegation-continuity.js";
import type { KnowledgeResidentHealth } from "./resident-health.js";

const CODE = /^[a-z][a-z0-9_]{0,63}$/u;
const REASON = /^[a-z][a-z0-9_:.-]{0,95}$/u;

const code = (value: string | null | undefined): string | null =>
  typeof value === "string" && CODE.test(value) ? value : null;

/** Pure: the record this host publishes; the scope comes from the delegation file itself. */
export function continuityHostRecord(input: {
  projectId: string;
  repositoryIdentityHash: string;
  host: ConvergenceOwnerHost;
  observedAt: string;
  continuity: DelegationContinuityResult;
  /** The delegation file after continuation; its scope is what peers may seed from. */
  delegation: ConvergenceDelegation | null;
  verdict: ConvergenceOwnerVerdict | null;
  publicationConfigured: boolean;
  publicationStatus: string | null;
  health: KnowledgeResidentHealth | null;
  findings: readonly ContinuityFinding[];
  providerAdmission?: ProviderCliAdmissionProjection | null;
  /** ADR-0612 M3: this host's selection, or null when it never chose. */
  modelSelection?: KnowledgeConvergenceHostModelSelection | null;
}): KnowledgeConvergenceHostRecord {
  const observation = input.continuity.delegation;
  const scope =
    input.delegation === null
      ? null
      : (convergenceDelegationScope(input.delegation) as unknown as Record<string, unknown>);
  const policy = input.continuity.policy;
  const role = code(input.verdict?.role);
  const reason = code(input.verdict?.reason);
  const residentReason =
    typeof input.health?.reason === "string" && REASON.test(input.health.reason)
      ? input.health.reason
      : null;
  return {
    ...(input.providerAdmission == null ? {} : { providerAdmission: input.providerAdmission }),
    ...(input.modelSelection == null ? {} : { modelSelection: input.modelSelection }),
    schemaVersion: 1,
    projectId: input.projectId,
    repositoryIdentityHash: input.repositoryIdentityHash,
    hostHash: input.host.hostHash,
    hostLabel: input.host.config.hostLabel,
    observedAt: input.observedAt,
    delegation:
      scope === null || !("expiresAt" in observation)
        ? null
        : {
            state: observation.state,
            expiresAt: observation.expiresAt,
            scopeHash: knowledgeConvergenceScopeHash(scope),
            scope,
          },
    continuity:
      policy.status === "loaded"
        ? {
            policy:
              policy.policy.state === "revoked"
                ? "revoked"
                : Date.parse(policy.policy.horizonAt) <= Date.parse(input.observedAt)
                  ? "exhausted"
                  : "active",
            horizonAt: policy.policy.horizonAt,
          }
        : { policy: policy.status, horizonAt: null },
    owner: role === null || reason === null ? null : { role, reason },
    publication: {
      configured: input.publicationConfigured,
      status: code(input.publicationStatus),
    },
    resident:
      input.health === null || input.health.state === null
        ? null
        : { state: input.health.state, reason: residentReason },
    findings: [...new Set(input.findings.map((finding) => finding.code))].slice(0, 32),
  };
}

export function continuityPeerSummary(
  record: KnowledgeConvergenceHostListing,
): ContinuityPeerSummary {
  return {
    ...(record.providerAdmission === undefined
      ? {}
      : { providerAdmission: record.providerAdmission }),
    ...(record.presence === undefined ? {} : { presence: record.presence }),
    hostHash: record.hostHash,
    hostLabel: record.hostLabel,
    observedAt: record.observedAt,
    delegationState: record.delegation?.state ?? "missing",
    delegationExpiresAt: record.delegation?.expiresAt ?? null,
    policy: record.continuity.policy,
    ownerRole: record.owner?.role ?? null,
    residentState: record.resident?.state ?? null,
  };
}
