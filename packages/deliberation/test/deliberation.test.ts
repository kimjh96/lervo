import type { DeliberationArtifact } from "@lervo/schemas";
import { calculateWritingPublicationPermitId } from "@lervo/writing-contract";
import { describe, expect, it } from "vitest";

import {
  calculateDeliberationArtifactId,
  deliberationSha256,
  validateDeliberationArtifact,
  validateDeliberationOutcome,
  validateDeliberationPolicy,
} from "../src/index.js";
import { artifact, claimId, convergedHistory, objectionId, outcome, policy } from "./fixtures.js";

describe("provider-neutral deliberation contracts", () => {
  it("accepts convergence only with an independent review, real verification, and owner decision", () => {
    const { artifacts, evidence } = convergedHistory();
    expect(() =>
      validateDeliberationOutcome({
        deliberationId: "dlb_architecture_0001",
        policy,
        artifacts,
        verificationEvidence: [evidence],
        outcome: outcome({
          artifacts,
          status: "converged",
          decisionArtifactId: artifacts[5]!.deliberationArtifactId,
          passedVerificationArtifactIds: [artifacts[4]!.deliberationArtifactId],
        }),
      }),
    ).not.toThrow();
  });

  it("rejects convergence when the final revision was not independently approved", () => {
    const { artifacts, evidence } = convergedHistory();
    const revision = artifacts[2]!;
    const verification = structuredClone(artifacts[4]!) as Extract<
      DeliberationArtifact,
      { kind: "verification" }
    >;
    verification.previousArtifactIds = [revision.deliberationArtifactId];
    verification.deliberationArtifactId = calculateDeliberationArtifactId(verification);
    const decision = structuredClone(artifacts[5]!) as Extract<
      DeliberationArtifact,
      { kind: "decision" }
    >;
    decision.previousArtifactIds = [verification.deliberationArtifactId];
    decision.details.verificationArtifactIds = [verification.deliberationArtifactId];
    decision.deliberationArtifactId = calculateDeliberationArtifactId(decision);
    const withoutApproval = [artifacts[0]!, artifacts[1]!, revision, verification, decision];
    expect(() =>
      validateDeliberationOutcome({
        deliberationId: "dlb_architecture_0001",
        policy,
        artifacts: withoutApproval,
        verificationEvidence: [evidence],
        outcome: outcome({
          artifacts: withoutApproval,
          status: "converged",
          decisionArtifactId: decision.deliberationArtifactId,
          passedVerificationArtifactIds: [verification.deliberationArtifactId],
        }),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "outcome_contract_invalid",
        reason: "independent_review_missing",
      }),
    );
  });

  it("rejects a passed verification artifact that does not match the actual result", () => {
    const { artifacts, evidence } = convergedHistory();
    const verificationIndex = artifacts.findIndex((item) => item.kind === "verification");
    const verification = structuredClone(artifacts[verificationIndex]!) as Extract<
      DeliberationArtifact,
      { kind: "verification" }
    >;
    verification.details.resultHash = deliberationSha256("forged result");
    verification.deliberationArtifactId = calculateDeliberationArtifactId(verification);
    const changed = artifacts.slice(0, verificationIndex + 1);
    changed[verificationIndex] = verification;
    expect(() =>
      validateDeliberationOutcome({
        deliberationId: "dlb_architecture_0001",
        policy,
        artifacts: changed,
        verificationEvidence: [evidence],
        outcome: outcome({ artifacts: changed, status: "failed" }),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "verification_evidence_invalid",
        reason: "verification_coordinate_mismatch",
      }),
    );
  });

  it("records an unresolved blocking objection as no_consensus", () => {
    const { artifacts } = convergedHistory();
    const unresolved = artifacts.slice(0, 2);
    expect(() =>
      validateDeliberationOutcome({
        deliberationId: "dlb_architecture_0001",
        policy,
        artifacts: unresolved,
        verificationEvidence: [],
        outcome: outcome({
          artifacts: unresolved,
          status: "no_consensus",
          reason: "blocking_objections_unresolved",
          unresolvedBlockingObjectionIds: [objectionId],
        }),
      }),
    ).not.toThrow();
  });

  it("does not accept max-rounds as a reason before the configured round", () => {
    const { artifacts } = convergedHistory();
    const unresolved = artifacts.slice(0, 2);
    expect(() =>
      validateDeliberationOutcome({
        deliberationId: "dlb_architecture_0001",
        policy,
        artifacts: unresolved,
        verificationEvidence: [],
        outcome: outcome({
          artifacts: unresolved,
          status: "no_consensus",
          reason: "max_rounds_reached",
          unresolvedBlockingObjectionIds: [objectionId],
        }),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "outcome_contract_invalid",
        reason: "no_consensus_reason_mismatch",
      }),
    );
  });

  it("rejects duplicate role assignments and provider choices outside policy", () => {
    const duplicate = structuredClone(policy);
    duplicate.participants[1]!.roleId = "architect";
    expect(() => validateDeliberationPolicy(duplicate)).toThrowError(
      expect.objectContaining({
        code: "policy_contract_invalid",
        reason: "policy_role_assignment_invalid",
      }),
    );

    const { artifacts } = convergedHistory();
    const proposal = structuredClone(artifacts[0]!) as DeliberationArtifact;
    proposal.producer.provider = "claude";
    proposal.deliberationArtifactId = calculateDeliberationArtifactId(proposal);
    expect(() => validateDeliberationArtifact(proposal, policy)).toThrowError(
      expect.objectContaining({
        code: "artifact_contract_invalid",
        reason: "provider_not_allowed",
      }),
    );
  });

  it("rejects writing permits copied from another content artifact", () => {
    const { artifacts } = convergedHistory();
    const proposal = structuredClone(artifacts[0]!) as DeliberationArtifact;
    proposal.writingPublicationPermit.contentHash = deliberationSha256("other content");
    proposal.writingPublicationPermit.permitId = calculateWritingPublicationPermitId(
      proposal.writingPublicationPermit,
    );
    proposal.deliberationArtifactId = calculateDeliberationArtifactId(proposal);
    expect(() => validateDeliberationArtifact(proposal, policy)).toThrowError(
      expect.objectContaining({
        code: "artifact_contract_invalid",
        reason: "writing_permit_mismatch",
      }),
    );
  });

  it("rejects verification evidence for an older claim version", () => {
    const { artifacts, evidence } = convergedHistory();
    const verification = structuredClone(artifacts[4]!) as Extract<
      DeliberationArtifact,
      { kind: "verification" }
    >;
    verification.details.targetClaims = [
      {
        claimId,
        claimDigest: deliberationSha256("claim:v1"),
      },
    ];
    verification.deliberationArtifactId = calculateDeliberationArtifactId(verification);
    const changed = [...artifacts.slice(0, 4), verification];

    expect(() =>
      validateDeliberationOutcome({
        deliberationId: "dlb_architecture_0001",
        policy,
        artifacts: changed,
        verificationEvidence: [evidence],
        outcome: outcome({ artifacts: changed, status: "failed" }),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "history_contract_invalid",
        reason: "stale_claim_verification",
      }),
    );
  });

  it("rejects duplicate claim identities inside one revision", () => {
    const { artifacts } = convergedHistory();
    const revision = structuredClone(artifacts[2]!) as Extract<
      DeliberationArtifact,
      { kind: "revision" }
    >;
    revision.details.claims.push({
      claimId,
      claimDigest: deliberationSha256("claim:conflicting-v2"),
    });
    revision.deliberationArtifactId = calculateDeliberationArtifactId(revision);
    const changed = [...artifacts.slice(0, 2), revision];

    expect(() =>
      validateDeliberationOutcome({
        deliberationId: "dlb_architecture_0001",
        policy,
        artifacts: changed,
        verificationEvidence: [],
        outcome: outcome({ artifacts: changed, status: "failed" }),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "history_contract_invalid",
        reason: "duplicate_claim",
      }),
    );
  });

  it.each([
    [
      "managed run",
      "cross_role_run_reuse",
      (review: DeliberationArtifact, proposal: DeliberationArtifact) => {
        review.producer.runId = proposal.producer.runId;
      },
    ],
    [
      "provider session",
      "cross_role_session_reuse",
      (review: DeliberationArtifact, proposal: DeliberationArtifact) => {
        review.producer.sessionId = proposal.producer.sessionId;
      },
    ],
    [
      "context receipt",
      "cross_role_receipt_reuse",
      (review: DeliberationArtifact, proposal: DeliberationArtifact) => {
        review.inputContext.injectedReceiptIds = [proposal.inputContext.injectedReceiptIds[0]!];
      },
    ],
  ])("rejects cross-role reuse of a %s", (_name, reason, mutate) => {
    const { artifacts } = convergedHistory();
    const proposal = artifacts[0]!;
    const review = structuredClone(artifacts[1]!) as DeliberationArtifact;
    mutate(review, proposal);
    review.deliberationArtifactId = calculateDeliberationArtifactId(review);
    const changed = [proposal, review];

    expect(() =>
      validateDeliberationOutcome({
        deliberationId: "dlb_architecture_0001",
        policy,
        artifacts: changed,
        verificationEvidence: [],
        outcome: outcome({ artifacts: changed, status: "failed" }),
      }),
    ).toThrowError(expect.objectContaining({ code: "history_contract_invalid", reason }));
  });

  it("rejects a proposer approving their own current proposal", () => {
    const { artifacts } = convergedHistory();
    const proposal = artifacts[0]!;
    const selfApproval = artifact({
      kind: "objection",
      round: 1,
      roleId: "architect",
      sessionId: "ses_architect_review_0001",
      provider: "codex",
      previousArtifactIds: [proposal.deliberationArtifactId],
      sequence: 7,
      details: { reviewStatus: "approved", objections: [] },
    });
    const changed = [proposal, selfApproval];

    expect(() =>
      validateDeliberationOutcome({
        deliberationId: "dlb_architecture_0001",
        policy,
        artifacts: changed,
        verificationEvidence: [],
        outcome: outcome({ artifacts: changed, status: "failed" }),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "history_contract_invalid",
        reason: "independent_review_missing",
      }),
    );
  });

  it("rejects an approval that points to an older proposal after revision", () => {
    const { artifacts } = convergedHistory();
    const approval = structuredClone(artifacts[3]!) as DeliberationArtifact;
    approval.previousArtifactIds = [artifacts[0]!.deliberationArtifactId];
    approval.deliberationArtifactId = calculateDeliberationArtifactId(approval);
    const changed = [...artifacts.slice(0, 3), approval];

    expect(() =>
      validateDeliberationOutcome({
        deliberationId: "dlb_architecture_0001",
        policy,
        artifacts: changed,
        verificationEvidence: [],
        outcome: outcome({ artifacts: changed, status: "failed" }),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "history_contract_invalid",
        reason: "independent_review_missing",
      }),
    );
  });

  it("rejects verification evidence that is not recorded in the artifact history", () => {
    const { artifacts, evidence } = convergedHistory();
    const changed = [artifacts[0]!];

    expect(() =>
      validateDeliberationOutcome({
        deliberationId: "dlb_architecture_0001",
        policy,
        artifacts: changed,
        verificationEvidence: [evidence],
        outcome: outcome({ artifacts: changed, status: "failed" }),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "verification_evidence_invalid",
        reason: "unexpected_verification_evidence",
      }),
    );
  });

  it("allows a failed outcome before the first artifact is confirmed", () => {
    expect(() =>
      validateDeliberationOutcome({
        deliberationId: "dlb_architecture_0001",
        policy,
        artifacts: [],
        verificationEvidence: [],
        outcome: outcome({ artifacts: [], status: "failed" }),
      }),
    ).not.toThrow();
  });

  it("binds a pre-artifact failure to the requested deliberation", () => {
    expect(() =>
      validateDeliberationOutcome({
        deliberationId: "dlb_another_0001",
        policy,
        artifacts: [],
        verificationEvidence: [],
        outcome: outcome({ artifacts: [], status: "failed" }),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "outcome_contract_invalid",
        reason: "outcome_coordinate_mismatch",
      }),
    );
  });
});
