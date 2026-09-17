import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import type { DeliberationArtifact, DeliberationPolicy } from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { projectDeliberationView } from "../src/index.js";

const projectId = "prj_deliberation_surface";
const deliberationId = "dlb_deliberation_surface";
const hash = (value: string) => `sha256:${value.repeat(64)}`;

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function policy(): DeliberationPolicy {
  return {
    schemaVersion: 1,
    policyId: "deliberation_product_surface",
    projectId,
    participants: [
      {
        roleId: "architect",
        responsibilities: ["proposer", "decision_owner"],
        providerSelection: { mode: "fixed", provider: "codex" },
      },
      {
        roleId: "reviewer",
        responsibilities: ["reviewer"],
        providerSelection: { mode: "fixed", provider: "claude" },
      },
      {
        roleId: "verifier",
        responsibilities: ["verifier"],
        providerSelection: { mode: "fixed", provider: "claude" },
      },
    ],
    decisionOwnerRoleId: "architect",
    maxRounds: 3,
    executionBudget: {
      maximumProviderCalls: 12,
      maximumObservedTokens: 250_000,
      maximumElapsedMs: 300_000,
      unobservedTokenDisposition: "block",
    },
    requiredVerificationSuiteIds: ["project.quick"],
    convergence: {
      requireIndependentReviewer: true,
      requireIndependentSessions: true,
      requireDecisionOwnerDecision: true,
      requirePassedVerifications: true,
      requireZeroUnresolvedBlockingObjections: true,
      unresolvedBlockingDisposition: "no_consensus",
    },
    publication: {
      surface: "documentation",
      writingPolicyId: "writing_product_surface",
      writingPolicyHash: hash("c"),
      requiresWritingPermit: true,
    },
  };
}

function input() {
  return {
    deliberationId,
    projectId,
    policy: policy(),
    artifacts: [],
    artifactSourceStatus: "complete" as const,
    verificationEvidence: [],
    verificationSourceStatus: "complete" as const,
    status: "running" as const,
    outcome: null,
    outcomeSourceStatus: "active" as const,
    origin: {
      sourceEventId: `cve_${"a".repeat(64)}`,
      conversationId: "cnv_deliberation_surface",
      threadId: "thd_deliberation_surface",
      requesterParticipantId: "ptc_deliberation_requester",
      originBindingDigest: hash("d"),
    },
    sourceEventHeadHash: hash("e"),
    repositoryRevision: hash("f"),
    resourceReportCoordinate: "report:deliberation-resources",
    publicationCoordinate: null,
    originDeliveryCoordinate: null,
  };
}

describe("deliberation product projector", () => {
  it("projects an active policy as an origin-bound decision view without inventing hired agents", () => {
    const report = projectDeliberationView(input());

    expect(validateSchema("productDeliberationView", report)).toEqual({ valid: true, errors: [] });
    expect(report).toMatchObject({
      deliberationId,
      status: "running",
      round: 0,
      maximumRounds: 3,
      nextAction: "wait",
      projectionStatus: "complete",
      participants: [
        { roleId: "architect", responsibility: "proposer", disposition: "policy_only" },
        { roleId: "architect", responsibility: "decision_owner", disposition: "policy_only" },
        { roleId: "reviewer", responsibility: "reviewer", disposition: "policy_only" },
        { roleId: "verifier", responsibility: "verifier", disposition: "policy_only" },
      ],
    });
  });

  it("keeps missing resource evidence partial instead of fabricating zero usage", () => {
    const report = projectDeliberationView({ ...input(), resourceReportCoordinate: null });

    expect(report).toMatchObject({
      projectionStatus: "partial",
      projectionReasonCode: "deliberation_resources_unavailable",
      resourceReportCoordinate: null,
    });
  });

  it("reports a legacy missing origin without inventing conversation coordinates", () => {
    const report = projectDeliberationView({ ...input(), origin: null });

    expect(report).toMatchObject({
      sourceEventId: null,
      conversationId: null,
      threadId: null,
      requesterParticipantId: null,
      originBindingDigest: null,
      projectionStatus: "unavailable",
      projectionReasonCode: "deliberation_origin_unavailable",
    });
  });

  it("reports legacy structured-artifact omission instead of treating an empty list as evidence", () => {
    const report = projectDeliberationView({
      ...input(),
      artifactSourceStatus: "unavailable",
    });

    expect(report).toMatchObject({
      artifacts: [],
      projectionStatus: "unavailable",
      projectionReasonCode: "deliberation_structured_artifact_unavailable",
    });
  });

  it("reports a terminal status whose validated outcome source is unavailable", () => {
    const report = projectDeliberationView({
      ...input(),
      status: "converged",
      outcomeSourceStatus: "unavailable",
    });

    expect(report).toMatchObject({
      status: "converged",
      nextAction: "none",
      projectionStatus: "unavailable",
      projectionReasonCode: "deliberation_outcome_unavailable",
    });
  });

  it("marks a participant binding with a different provider policy invalid", () => {
    const report = projectDeliberationView({
      ...input(),
      participantBindings: [
        {
          roleId: "architect",
          provider: "claude",
          providerPolicyHash: digest({ schemaVersion: 1, provider: "claude" }),
          participantId: "ptc_bound_architect",
          agentId: `agt_${"1".repeat(24)}`,
          roleVersion: "2.0.0",
        },
      ],
    });

    expect(report).toMatchObject({
      projectionStatus: "invalid",
      projectionReasonCode: "deliberation_participant_binding_invalid",
    });
  });

  it("returns an invalid projection for a contradictory artifact history", () => {
    const invalidArtifact = {
      deliberationArtifactId: `dla_${"1".repeat(16)}`,
      kind: "proposal",
      round: 1,
      producer: {
        roleId: "architect",
        provider: "codex",
        runId: "run_deliberation_surface",
        sessionId: "ses_deliberation_surface",
      },
      content: { contentHash: hash("8") },
      previousArtifactIds: [],
      details: { claims: [{ claimId: `clm_${"2".repeat(16)}` }] },
    } as unknown as DeliberationArtifact;
    const report = projectDeliberationView({ ...input(), artifacts: [invalidArtifact] });

    expect(report).toMatchObject({
      projectionStatus: "invalid",
      projectionReasonCode: "deliberation_history_invalid",
      artifacts: [{ artifactId: invalidArtifact.deliberationArtifactId, kind: "proposal" }],
    });
  });
});
