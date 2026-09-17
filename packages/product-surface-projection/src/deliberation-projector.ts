import { createHash } from "node:crypto";

import {
  analyzeDeliberationHistory,
  deliberationPolicyHash,
  type DeliberationVerificationEvidence,
  validateDeliberationOutcome,
} from "@lervo/deliberation";
import { canonicalJson } from "@lervo/event-contract";
import {
  type DeliberationArtifact,
  type DeliberationOutcome,
  type DeliberationPolicy,
  type ProductDeliberationViewV1,
  validateSchema,
} from "@lervo/schemas";

type ProductDeliberationStatus =
  "running" | "unknown" | "interrupted" | "converged" | "no_consensus" | "failed";

export interface ProductDeliberationOriginV1 {
  sourceEventId: string;
  conversationId: string;
  threadId: string | null;
  requesterParticipantId: string;
  originBindingDigest: string;
}

export interface ProductDeliberationParticipantBindingV1 {
  roleId: string;
  provider: "codex" | "claude" | "any";
  providerPolicyHash: string;
  participantId: string;
  agentId: string;
  roleVersion: string;
}

export interface ProductDeliberationProjectionInputV1 {
  deliberationId: string;
  projectId: string;
  policy: DeliberationPolicy;
  artifacts: readonly DeliberationArtifact[];
  artifactSourceStatus: "complete" | "unavailable" | "invalid";
  verificationEvidence: readonly DeliberationVerificationEvidence[];
  verificationSourceStatus: "complete" | "unavailable" | "invalid";
  status: ProductDeliberationStatus;
  outcome: DeliberationOutcome | null;
  outcomeSourceStatus: "active" | "complete" | "unavailable" | "invalid";
  origin: ProductDeliberationOriginV1 | null;
  participantBindings?: readonly ProductDeliberationParticipantBindingV1[];
  sourceEventHeadHash: string;
  repositoryRevision: string;
  resourceReportCoordinate: string | null;
  publicationCoordinate: string | null;
  originDeliveryCoordinate: string | null;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function providerPolicyHash(policy: DeliberationPolicy["participants"][number]): string {
  return digest(policy.providerSelection);
}

function providerAllowed(
  selection: DeliberationPolicy["participants"][number]["providerSelection"],
  provider: ProductDeliberationParticipantBindingV1["provider"],
): boolean {
  if (provider === "any") return true;
  return selection.mode === "fixed"
    ? selection.provider === provider
    : selection.providers.includes(provider);
}

function claimIds(artifact: DeliberationArtifact): string[] {
  switch (artifact.kind) {
    case "proposal":
    case "revision":
      return artifact.details.claims.map((claim) => claim.claimId);
    case "objection":
      return [...new Set(artifact.details.objections.flatMap((item) => item.targetClaimIds))];
    case "verification":
      return artifact.details.targetClaims.map((claim) => claim.claimId);
    case "decision":
      return [...artifact.details.adoptedClaimIds];
  }
}

function objectionIds(artifact: DeliberationArtifact): string[] {
  switch (artifact.kind) {
    case "objection":
      return artifact.details.objections.map((objection) => objection.objectionId);
    case "revision":
      return [...artifact.details.resolvesObjectionIds];
    case "decision":
      return [...artifact.details.unresolvedObjectionIds];
    case "proposal":
    case "verification":
      return [];
  }
}

function verificationIds(artifact: DeliberationArtifact): string[] {
  return artifact.kind === "verification" ? [artifact.details.verificationId] : [];
}

function terminalReason(outcome: DeliberationOutcome | null): string | null {
  if (outcome === null || outcome.status === "converged") return null;
  if (outcome.status === "no_consensus") return outcome.noConsensusReason;
  return outcome.failure.code;
}

export function projectDeliberationView(
  input: ProductDeliberationProjectionInputV1,
): ProductDeliberationViewV1 {
  const terminal = ["converged", "no_consensus", "failed"].includes(input.status);
  const sourceCombinationValid =
    (input.outcomeSourceStatus === "active" && !terminal && input.outcome === null) ||
    (input.outcomeSourceStatus === "complete" &&
      terminal &&
      input.outcome !== null &&
      input.outcome.status === input.status) ||
    (input.outcomeSourceStatus === "unavailable" && terminal && input.outcome === null) ||
    (input.outcomeSourceStatus === "invalid" && input.outcome === null);
  if (!sourceCombinationValid) {
    throw new Error("The deliberation status and outcome source disposition differ.");
  }
  if (
    input.policy.projectId !== input.projectId ||
    (input.outcome !== null &&
      (input.outcome.projectId !== input.projectId ||
        input.outcome.deliberationId !== input.deliberationId))
  ) {
    throw new Error("The deliberation projection coordinates do not match.");
  }

  let history;
  let historyInvalid = false;
  try {
    history = analyzeDeliberationHistory({
      policy: input.policy,
      artifacts: input.artifacts,
      verificationEvidence: input.verificationEvidence,
    });
    if (input.outcome !== null) {
      validateDeliberationOutcome({
        deliberationId: input.deliberationId,
        policy: input.policy,
        artifacts: input.artifacts,
        verificationEvidence: input.verificationEvidence,
        outcome: input.outcome,
      });
    }
  } catch {
    historyInvalid = true;
    history = null;
  }

  const bindings = new Map(
    (input.participantBindings ?? []).map((binding) => [binding.roleId, binding]),
  );
  if (bindings.size !== (input.participantBindings ?? []).length) {
    throw new Error("A deliberation participant binding is duplicated.");
  }
  const policyRoleIds = new Set(input.policy.participants.map((participant) => participant.roleId));
  const participantBindingInvalid = [...bindings].some(([roleId, binding]) => {
    const participant = input.policy.participants.find((item) => item.roleId === roleId);
    return (
      !policyRoleIds.has(roleId) ||
      participant === undefined ||
      providerPolicyHash(participant) !== binding.providerPolicyHash ||
      !providerAllowed(participant.providerSelection, binding.provider)
    );
  });
  const participants = input.policy.participants.flatMap((participant) =>
    participant.responsibilities.map((responsibility) => {
      const binding = bindings.get(participant.roleId);
      if (binding === undefined) {
        return {
          roleId: participant.roleId,
          responsibility,
          providerPolicyHash: providerPolicyHash(participant),
          disposition: "policy_only" as const,
          participantId: null,
          agentId: null,
          roleVersion: null,
        };
      }
      return {
        roleId: participant.roleId,
        responsibility,
        providerPolicyHash: binding.providerPolicyHash,
        disposition: "hired_agent" as const,
        participantId: binding.participantId,
        agentId: binding.agentId,
        roleVersion: binding.roleVersion,
      };
    }),
  );

  const artifacts = input.artifacts.map((artifact) => ({
    artifactId: artifact.deliberationArtifactId,
    kind: artifact.kind,
    round: artifact.round,
    producerRoleId: artifact.producer.roleId,
    provider: artifact.producer.provider,
    runId: artifact.producer.runId,
    sessionId: artifact.producer.sessionId,
    contentHash: artifact.content.contentHash,
    previousArtifactIds: [...artifact.previousArtifactIds],
    writingPermitStatus: "valid" as const,
    claimIds: claimIds(artifact),
    objectionIds: objectionIds(artifact),
    verificationIds: verificationIds(artifact),
    decisionCoordinate:
      artifact.kind === "decision" ? `decision:${artifact.deliberationArtifactId}` : null,
  }));
  const verifications = input.artifacts.flatMap((artifact) => {
    if (artifact.kind !== "verification") return [];
    const evidence = input.verificationEvidence.find(
      (candidate) => candidate.result.verificationId === artifact.details.verificationId,
    );
    return [
      {
        verificationId: artifact.details.verificationId,
        suiteId: artifact.details.suiteId,
        artifactId: artifact.deliberationArtifactId,
        status: evidence?.result.status ?? ("unavailable" as const),
        resultHash: evidence?.resultArtifact.contentHash ?? null,
      },
    ];
  });
  const unresolvedObjections = (history?.openBlockingObjectionIds ?? []).map((objectionId) => {
    const artifact = input.artifacts.find(
      (candidate) =>
        candidate.kind === "objection" &&
        candidate.details.objections.some((objection) => objection.objectionId === objectionId),
    );
    if (artifact === undefined) {
      throw new Error("An open deliberation objection has no source artifact.");
    }
    return {
      objectionId,
      artifactId: artifact.deliberationArtifactId,
      blocking: true as const,
      status: "open" as const,
    };
  });

  const status = input.status;
  const invalidSourceReason =
    input.artifactSourceStatus === "invalid"
      ? "deliberation_structured_artifact_invalid"
      : input.verificationSourceStatus === "invalid"
        ? "deliberation_verification_evidence_invalid"
        : input.outcomeSourceStatus === "invalid"
          ? "deliberation_outcome_event_invalid"
          : null;
  const unavailableSourceReason =
    input.origin === null
      ? "deliberation_origin_unavailable"
      : input.artifactSourceStatus === "unavailable"
        ? "deliberation_structured_artifact_unavailable"
        : input.verificationSourceStatus === "unavailable"
          ? "deliberation_verification_evidence_unavailable"
          : input.outcomeSourceStatus === "unavailable"
            ? "deliberation_outcome_unavailable"
            : null;
  const missingReason = invalidSourceReason
    ? invalidSourceReason
    : unavailableSourceReason
      ? unavailableSourceReason
      : historyInvalid
        ? "deliberation_history_invalid"
        : participantBindingInvalid
          ? "deliberation_participant_binding_invalid"
          : status === "unknown"
            ? "deliberation_status_unknown"
            : status === "interrupted"
              ? "deliberation_interrupted"
              : input.resourceReportCoordinate === null
                ? "deliberation_resources_unavailable"
                : terminal && input.publicationCoordinate === null
                  ? "deliberation_publication_unavailable"
                  : terminal && input.originDeliveryCoordinate === null
                    ? "deliberation_delivery_unavailable"
                    : null;
  const report = {
    schemaVersion: 1 as const,
    kind: "product_surface.deliberation" as const,
    deliberationId: input.deliberationId,
    projectId: input.projectId,
    policyId: input.policy.policyId,
    policyHash: deliberationPolicyHash(input.policy),
    sourceEventId: input.origin?.sourceEventId ?? null,
    conversationId: input.origin?.conversationId ?? null,
    threadId: input.origin?.threadId ?? null,
    requesterParticipantId: input.origin?.requesterParticipantId ?? null,
    originBindingDigest: input.origin?.originBindingDigest ?? null,
    sourceEventHeadHash: input.sourceEventHeadHash,
    repositoryRevision: input.repositoryRevision,
    status,
    round: history?.lastRound ?? Math.max(0, ...input.artifacts.map((artifact) => artifact.round)),
    maximumRounds: input.policy.maxRounds,
    nextAction:
      status === "running"
        ? ("wait" as const)
        : status === "interrupted"
          ? ("resume" as const)
          : ("none" as const),
    terminalReason: terminalReason(input.outcome),
    participants,
    artifacts,
    verifications,
    unresolvedObjections,
    resourceReportCoordinate: input.resourceReportCoordinate,
    publicationCoordinate: input.publicationCoordinate,
    originDeliveryCoordinate: input.originDeliveryCoordinate,
    projectionStatus:
      invalidSourceReason !== null || historyInvalid || participantBindingInvalid
        ? ("invalid" as const)
        : unavailableSourceReason !== null
          ? ("unavailable" as const)
          : missingReason === null
            ? ("complete" as const)
            : ("partial" as const),
    projectionReasonCode: missingReason,
  };
  const output = { ...report, projectionDigest: digest(report) };
  const validation = validateSchema("productDeliberationView", output);
  if (!validation.valid) {
    throw new Error("The projected deliberation view violates its canonical schema.");
  }
  return output as ProductDeliberationViewV1;
}
