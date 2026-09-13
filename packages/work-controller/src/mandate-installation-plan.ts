import type {
  InstalledOperatingMandate,
  MandateInstallationPlan,
  MandateInstallationSource,
  OperatingMandate,
} from "@lervo/application-contract";
import {
  assertOperatingMandate,
  operatingHashPattern,
  operatingTime,
} from "./operating-contract-validation.js";
import { operatingContractHash } from "./operating-mandate-admission.js";

export function assertMandateExecutionSuccession(
  previous: InstalledOperatingMandate | null,
  mandate: OperatingMandate,
): void {
  if (previous === null) return;
  if (
    previous.mandate.schemaVersion !== 1 &&
    (mandate.schemaVersion === 1 ||
      mandate.executionAuthority.hostIdentityHash !==
        previous.mandate.executionAuthority.hostIdentityHash)
  )
    throw new Error(
      "A designated execution host cannot be changed or removed by mandate succession.",
    );
  if (previous.mandate.schemaVersion === 1 && mandate.schemaVersion !== 1 && !previous.revoked)
    throw new Error("Revoke the local-only mandate before designating an execution host.");
  if (
    previous.mandate.schemaVersion === 3 &&
    (mandate.schemaVersion !== 3 ||
      operatingContractHash(mandate.workScope) !==
        operatingContractHash(previous.mandate.workScope))
  )
    throw new Error("Mandate succession cannot reset or remove its reviewed work scope.");
  if (previous.mandate.schemaVersion !== 3 && mandate.schemaVersion === 3 && !previous.revoked)
    throw new Error("Revoke the workstream-wide mandate before installing a bounded work scope.");
}

export function planMandateInstallation(input: {
  supervisionId: string;
  mandate: OperatingMandate;
  source: MandateInstallationSource;
  previous: InstalledOperatingMandate | null;
  reviewerId: string;
  now: string;
}): MandateInstallationPlan {
  const { mandate, source, previous } = structuredClone(input);
  assertOperatingMandate(mandate);
  assertMandateExecutionSuccession(previous, mandate);
  if (
    !/^[a-z][a-z0-9_.:-]{0,127}$/u.test(input.supervisionId) ||
    input.reviewerId !== mandate.appointingAuthorityId ||
    !source.eligible ||
    source.reasonCodes.length !== 0 ||
    source.ownerAgentId !== mandate.ownerAgentId ||
    mandate.projectIds.length !== 1 ||
    mandate.projectIds[0] !== source.projectId ||
    mandate.teamIds.length !== 1 ||
    mandate.teamIds[0] !== source.teamId ||
    !/^wks_[a-f0-9]{24}$/u.test(source.workstreamId) ||
    !Number.isSafeInteger(source.workstreamRevision) ||
    source.workstreamRevision < 1 ||
    !operatingHashPattern.test(source.sourceRevisionDigest) ||
    source.causationEventIds.length === 0 ||
    source.causationEventIds.length > 64 ||
    new Set(source.causationEventIds).size !== source.causationEventIds.length ||
    !source.causationEventIds.every((id) => /^evt_[a-f0-9]{32}$/u.test(id)) ||
    !operatingTime(input.now) ||
    Date.parse(input.now) < Date.parse(mandate.issuedAt) ||
    Date.parse(input.now) >= Date.parse(mandate.expiresAt)
  )
    throw new Error("The mandate installation authority is invalid or unavailable.");
  if (
    previous !== null &&
    (mandate.mandateId !== previous.mandate.mandateId ||
      mandate.version <= previous.mandate.version ||
      mandate.appointingAuthorityId !== previous.mandate.appointingAuthorityId)
  )
    throw new Error(
      "A successor mandate requires the same appointing authority and a later version.",
    );
  const content = {
    schemaVersion: 1 as const,
    kind: "operating_mandate.installation" as const,
    supervisionId: input.supervisionId,
    mandate,
    mandateHash: operatingContractHash(mandate),
    source,
    predecessorEventId: previous?.latestEventId ?? null,
    predecessorMandateHash: previous?.mandateHash ?? null,
    reviewerIdDigest: operatingContractHash({ reviewerId: input.reviewerId }),
  };
  return { ...content, approvalHash: operatingContractHash(content) };
}

export function assertMandateInstallationPlan(plan: MandateInstallationPlan): void {
  const { approvalHash, ...content } = plan;
  assertOperatingMandate(plan.mandate);
  const rebuilt = planMandateInstallation({
    supervisionId: plan.supervisionId,
    mandate: plan.mandate,
    source: plan.source,
    previous: null,
    reviewerId: plan.mandate.appointingAuthorityId,
    now: plan.mandate.issuedAt,
  });
  const { approvalHash: _initialApproval, ...initial } = rebuilt;
  const expected = {
    ...initial,
    predecessorEventId: plan.predecessorEventId,
    predecessorMandateHash: plan.predecessorMandateHash,
  };
  if (
    plan.schemaVersion !== 1 ||
    plan.kind !== "operating_mandate.installation" ||
    operatingContractHash(content) !== operatingContractHash(expected) ||
    (plan.predecessorEventId !== null && !/^evt_[a-f0-9]{32}$/u.test(plan.predecessorEventId)) ||
    (plan.predecessorMandateHash !== null &&
      !operatingHashPattern.test(plan.predecessorMandateHash)) ||
    (plan.predecessorEventId === null) !== (plan.predecessorMandateHash === null) ||
    approvalHash !== operatingContractHash(content) ||
    plan.mandateHash !== operatingContractHash(plan.mandate) ||
    plan.reviewerIdDigest !==
      operatingContractHash({ reviewerId: plan.mandate.appointingAuthorityId }) ||
    !plan.source.eligible ||
    plan.source.reasonCodes.length !== 0
  )
    throw new Error("The mandate installation differs from its exact reviewed plan.");
}
