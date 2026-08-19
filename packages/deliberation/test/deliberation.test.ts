import {
  type DeliberationArtifact,
  type DeliberationOutcome,
  type DeliberationPolicy,
  type VerificationCommand,
  type VerificationResult,
  type VerificationSuite,
  type WritingPublicationPermit,
} from "@lervo/schemas";
import {
  calculateVerificationId,
  verificationCommandDigest,
  verificationResultBytes,
  verificationSha256,
  verificationSuiteHash,
} from "@lervo/verification";
import {
  calculateWritingPublicationPermitId,
} from "@lervo/writing";
import { describe, expect, it } from "vitest";

import {
  calculateDeliberationArtifactId,
  calculateDeliberationOutcomeId,
  deliberationPolicyHash,
  deliberationSha256,
  validateDeliberationArtifact,
  validateDeliberationOutcome,
  validateDeliberationPolicy,
  type DeliberationVerificationEvidence,
} from "../src/index.js";

const policy: DeliberationPolicy = {
  schemaVersion: 1,
  policyId: "deliberation_architecture-review",
  projectId: "prj_deliberation_0001",
  participants: [
    {
      roleId: "architect",
      responsibilities: ["proposer", "reviewer"],
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
      providerSelection: { mode: "allowlist", providers: ["codex", "claude"] },
    },
    {
      roleId: "lead",
      responsibilities: ["decision_owner"],
      providerSelection: { mode: "fixed", provider: "codex" },
    },
  ],
  decisionOwnerRoleId: "lead",
  maxRounds: 3,
  requiredVerificationSuiteIds: ["architecture.contract"],
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
    writingPolicyId: "writing_ko-kr-human",
    writingPolicyHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    requiresWritingPermit: true,
  },
};

const claimId = "clm_architecture_0001";
const objectionId = "obj_architecture_0001";

function finalizeArtifact(
  value: Omit<DeliberationArtifact, "deliberationArtifactId">,
): DeliberationArtifact {
  const artifact = {
    ...value,
    deliberationArtifactId: "dla_0000000000000000",
  } as DeliberationArtifact;
  return {
    ...artifact,
    deliberationArtifactId: calculateDeliberationArtifactId(artifact),
  } as DeliberationArtifact;
}

function artifact(input: {
  kind: DeliberationArtifact["kind"];
  round: number;
  roleId: string;
  sessionId: string;
  provider: string;
  previousArtifactIds: string[];
  sequence: number;
  details: DeliberationArtifact["details"];
}): DeliberationArtifact {
  const contentHash = deliberationSha256(
    `${input.kind}:${input.roleId}:${input.round}:${input.sequence}`,
  );
  const digest = contentHash.slice(7);
  const issuedAt = `2026-08-19T00:00:${String(input.sequence * 2).padStart(2, "0")}Z`;
  const permitContent: Omit<WritingPublicationPermit, "permitId"> = {
    schemaVersion: 1,
    surface: policy.publication.surface,
    artifactId: `art_${digest}`,
    contentHash,
    writingPolicyId: policy.publication.writingPolicyId,
    writingPolicyHash: policy.publication.writingPolicyHash,
    evaluationId: `wre_${String(input.sequence).padStart(8, "0")}`,
    evaluationHash: deliberationSha256(`evaluation:${input.sequence}`),
    issuedAt,
  };
  const writingPublicationPermit: WritingPublicationPermit = {
    ...permitContent,
    permitId: calculateWritingPublicationPermitId(permitContent),
  };
  return finalizeArtifact({
    schemaVersion: 1,
    deliberationId: "dlb_architecture_0001",
    projectId: policy.projectId,
    policyId: policy.policyId,
    policyHash: deliberationPolicyHash(policy),
    kind: input.kind,
    round: input.round,
    producer: {
      roleId: input.roleId,
      runId: `run_${input.roleId}_0001`,
      sessionId: input.sessionId,
      provider: input.provider,
    },
    content: {
      artifactId: `art_${digest}`,
      uri: `lervo-cas://sha256/${digest}`,
      mediaType: "text/markdown; charset=utf-8",
      contentHash,
      byteCount: 100 + input.sequence,
    },
    inputContext: {
      contextGeneration: input.round - 1,
      sharedContextIds: input.kind === "proposal" ? [] : [`scx_${input.roleId}_0001`],
      loadedReceiptIds: [`ctx_loaded_${input.roleId}_${input.sequence}`],
      injectedReceiptIds: [`ctx_injected_${input.roleId}_${input.sequence}`],
    },
    previousArtifactIds: input.previousArtifactIds,
    evidenceEventIds: [`evt_evidence_${String(input.sequence).padStart(8, "0")}`],
    writingPublicationPermit,
    details: input.details,
    createdAt: `2026-08-19T00:00:${String(input.sequence * 2 + 1).padStart(2, "0")}Z`,
  } as Omit<DeliberationArtifact, "deliberationArtifactId">);
}

function verificationEvidence(): DeliberationVerificationEvidence {
  const command: VerificationCommand = {
    commandId: "typecheck",
    executable: "pnpm",
    arguments: ["typecheck"],
    cwd: ".",
    timeoutMs: 60_000,
    maxOutputBytes: 1024,
    environmentVariableNames: [],
  };
  const suite: VerificationSuite = {
    schemaVersion: 1,
    suiteId: "architecture.contract",
    stopOnFailure: true,
    commands: [command],
  };
  const emptyHash = verificationSha256(new Uint8Array());
  const emptyDigest = emptyHash.slice(7);
  const outputArtifact = {
    artifactId: `art_${emptyDigest}`,
    uri: `lervo-cas://sha256/${emptyDigest}`,
    contentHash: emptyHash,
    byteCount: 0,
  };
  const resultContent: Omit<VerificationResult, "verificationId"> = {
    schemaVersion: 1,
    suiteId: suite.suiteId,
    suiteHash: verificationSuiteHash(suite),
    repositoryRevision: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    startedAt: "2026-08-19T00:00:08Z",
    completedAt: "2026-08-19T00:00:09Z",
    status: "passed",
    commands: [{
      commandId: command.commandId,
      commandDigest: verificationCommandDigest(command),
      status: "passed",
      exitCode: 0,
      startedAt: "2026-08-19T00:00:08Z",
      completedAt: "2026-08-19T00:00:09Z",
      durationMs: 1000,
      stdoutArtifact: outputArtifact,
      stderrArtifact: outputArtifact,
      failureCode: null,
    }],
  };
  const result: VerificationResult = {
    ...resultContent,
    verificationId: calculateVerificationId(resultContent),
  };
  const bytes = verificationResultBytes(result);
  const resultHash = verificationSha256(bytes);
  const resultDigest = resultHash.slice(7);
  return {
    suite,
    result,
    resultArtifact: {
      artifactId: `art_${resultDigest}`,
      uri: `lervo-cas://sha256/${resultDigest}`,
      mediaType: "application/vnd.lervo.verification-result+json; charset=utf-8",
      contentHash: resultHash,
      byteCount: bytes.byteLength,
    },
  };
}

function convergedHistory(): {
  artifacts: DeliberationArtifact[];
  evidence: DeliberationVerificationEvidence;
} {
  const evidence = verificationEvidence();
  const proposal = artifact({
    kind: "proposal",
    round: 1,
    roleId: "architect",
    sessionId: "ses_architect_0001",
    provider: "codex",
    previousArtifactIds: [],
    sequence: 1,
    details: { claims: [{ claimId, claimDigest: deliberationSha256("claim:v1") }] },
  });
  const changesRequested = artifact({
    kind: "objection",
    round: 1,
    roleId: "reviewer",
    sessionId: "ses_reviewer_0001",
    provider: "claude",
    previousArtifactIds: [proposal.deliberationArtifactId],
    sequence: 2,
    details: {
      reviewStatus: "changes_requested",
      objections: [{
        objectionId,
        objectionDigest: deliberationSha256("objection"),
        targetClaimIds: [claimId],
        blocking: true,
        status: "open",
      }],
    },
  });
  const revision = artifact({
    kind: "revision",
    round: 2,
    roleId: "architect",
    sessionId: "ses_architect_0002",
    provider: "codex",
    previousArtifactIds: [proposal.deliberationArtifactId, changesRequested.deliberationArtifactId],
    sequence: 3,
    details: {
      revisesArtifactId: proposal.deliberationArtifactId,
      claims: [{ claimId, claimDigest: deliberationSha256("claim:v2") }],
      resolvesObjectionIds: [objectionId],
    },
  });
  const approved = artifact({
    kind: "objection",
    round: 2,
    roleId: "reviewer",
    sessionId: "ses_reviewer_0002",
    provider: "claude",
    previousArtifactIds: [revision.deliberationArtifactId],
    sequence: 4,
    details: { reviewStatus: "approved", objections: [] },
  });
  const verification = artifact({
    kind: "verification",
    round: 2,
    roleId: "verifier",
    sessionId: "ses_verifier_0001",
    provider: "claude",
    previousArtifactIds: [approved.deliberationArtifactId],
    sequence: 5,
    details: {
      verificationId: evidence.result.verificationId,
      suiteId: evidence.result.suiteId,
      resultArtifactId: evidence.resultArtifact.artifactId,
      resultHash: evidence.resultArtifact.contentHash,
      status: "passed",
      targetClaims: [{ claimId, claimDigest: deliberationSha256("claim:v2") }],
    },
  });
  const decision = artifact({
    kind: "decision",
    round: 2,
    roleId: "lead",
    sessionId: "ses_lead_0001",
    provider: "codex",
    previousArtifactIds: [verification.deliberationArtifactId],
    sequence: 6,
    details: {
      decisionOwnerRoleId: "lead",
      adoptedClaimIds: [claimId],
      verificationArtifactIds: [verification.deliberationArtifactId],
      unresolvedObjectionIds: [],
    },
  });
  return { artifacts: [proposal, changesRequested, revision, approved, verification, decision], evidence };
}

function outcome(input: {
  artifacts: readonly DeliberationArtifact[];
  status: DeliberationOutcome["status"];
  reason?: "max_rounds_reached" | "blocking_objections_unresolved" |
    "required_verification_not_passed";
}): DeliberationOutcome {
  const decision = input.artifacts.find((item) => item.kind === "decision");
  const passed = input.artifacts
    .filter((item) => item.kind === "verification" && item.details.status === "passed")
    .map((item) => item.deliberationArtifactId);
  const unresolved = input.artifacts
    .filter((item) => item.kind === "objection")
    .flatMap((item) => item.details.objections)
    .filter((item) => item.blocking)
    .map((item) => item.objectionId)
    .filter((id) => !input.artifacts.some((item) =>
      item.kind === "revision" && item.details.resolvesObjectionIds.includes(id)
    ));
  const common = {
    schemaVersion: 1 as const,
    outcomeId: "dlo_0000000000000000",
    deliberationId: "dlb_architecture_0001",
    projectId: policy.projectId,
    policyId: policy.policyId,
    policyHash: deliberationPolicyHash(policy),
    lastRound: Math.max(1, ...input.artifacts.map((item) => item.round)),
    artifactIds: input.artifacts.map((item) => item.deliberationArtifactId),
    lastConfirmedArtifactId: input.artifacts.at(-1)?.deliberationArtifactId ?? null,
    passedVerificationArtifactIds: passed,
    unresolvedBlockingObjectionIds: unresolved,
    completedAt: "2026-08-19T00:00:20Z",
  };
  let value: DeliberationOutcome;
  if (input.status === "converged") {
    value = {
      ...common,
      status: "converged",
      decisionArtifactId: decision?.deliberationArtifactId ?? "dla_0000000000000000",
      noConsensusReason: null,
      failure: null,
    };
  } else if (input.status === "no_consensus") {
    value = {
      ...common,
      status: "no_consensus",
      decisionArtifactId: null,
      noConsensusReason: input.reason ?? "blocking_objections_unresolved",
      failure: null,
    };
  } else {
    value = {
      ...common,
      status: "failed",
      decisionArtifactId: null,
      noConsensusReason: null,
      failure: { phase: "provider", code: "provider_turn_failed", retryable: false },
    };
  }
  return { ...value, outcomeId: calculateDeliberationOutcomeId(value) } as DeliberationOutcome;
}

describe("provider-neutral deliberation contracts", () => {
  it("accepts convergence only with an independent review, real verification, and owner decision", () => {
    const { artifacts, evidence } = convergedHistory();
    expect(() => validateDeliberationOutcome({
      deliberationId: "dlb_architecture_0001",
      policy,
      artifacts,
      verificationEvidence: [evidence],
      outcome: outcome({ artifacts, status: "converged" }),
    })).not.toThrow();
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
    expect(() => validateDeliberationOutcome({
      deliberationId: "dlb_architecture_0001",
      policy,
      artifacts: withoutApproval,
      verificationEvidence: [evidence],
      outcome: outcome({ artifacts: withoutApproval, status: "converged" }),
    })).toThrowError(expect.objectContaining({ code: "outcome_contract_invalid" }));
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
    expect(() => validateDeliberationOutcome({
      deliberationId: "dlb_architecture_0001",
      policy,
      artifacts: changed,
      verificationEvidence: [evidence],
      outcome: outcome({ artifacts: changed, status: "failed" }),
    })).toThrowError(expect.objectContaining({ code: "verification_evidence_invalid" }));
  });

  it("records an unresolved blocking objection as no_consensus", () => {
    const { artifacts } = convergedHistory();
    const unresolved = artifacts.slice(0, 2);
    expect(() => validateDeliberationOutcome({
      deliberationId: "dlb_architecture_0001",
      policy,
      artifacts: unresolved,
      verificationEvidence: [],
      outcome: outcome({
        artifacts: unresolved,
        status: "no_consensus",
        reason: "blocking_objections_unresolved",
      }),
    })).not.toThrow();
  });

  it("does not accept max-rounds as a reason before the configured round", () => {
    const { artifacts } = convergedHistory();
    const unresolved = artifacts.slice(0, 2);
    expect(() => validateDeliberationOutcome({
      deliberationId: "dlb_architecture_0001",
      policy,
      artifacts: unresolved,
      verificationEvidence: [],
      outcome: outcome({ artifacts: unresolved, status: "no_consensus", reason: "max_rounds_reached" }),
    })).toThrowError(expect.objectContaining({ code: "outcome_contract_invalid" }));
  });

  it("rejects duplicate role assignments and provider choices outside policy", () => {
    const duplicate = structuredClone(policy);
    duplicate.participants[1]!.roleId = "architect";
    expect(() => validateDeliberationPolicy(duplicate))
      .toThrowError(expect.objectContaining({ code: "policy_contract_invalid" }));

    const { artifacts } = convergedHistory();
    const proposal = structuredClone(artifacts[0]!) as DeliberationArtifact;
    proposal.producer.provider = "claude";
    proposal.deliberationArtifactId = calculateDeliberationArtifactId(proposal);
    expect(() => validateDeliberationArtifact(proposal, policy))
      .toThrowError(expect.objectContaining({ code: "artifact_contract_invalid" }));
  });

  it("rejects writing permits copied from another content artifact", () => {
    const { artifacts } = convergedHistory();
    const proposal = structuredClone(artifacts[0]!) as DeliberationArtifact;
    proposal.writingPublicationPermit.contentHash = deliberationSha256("other content");
    proposal.writingPublicationPermit.permitId = calculateWritingPublicationPermitId(
      proposal.writingPublicationPermit,
    );
    proposal.deliberationArtifactId = calculateDeliberationArtifactId(proposal);
    expect(() => validateDeliberationArtifact(proposal, policy))
      .toThrowError(expect.objectContaining({ code: "artifact_contract_invalid" }));
  });

  it("rejects verification evidence for an older claim version", () => {
    const { artifacts, evidence } = convergedHistory();
    const verification = structuredClone(artifacts[4]!) as Extract<
      DeliberationArtifact,
      { kind: "verification" }
    >;
    verification.details.targetClaims = [{
      claimId,
      claimDigest: deliberationSha256("claim:v1"),
    }];
    verification.deliberationArtifactId = calculateDeliberationArtifactId(verification);
    const changed = [...artifacts.slice(0, 4), verification];

    expect(() => validateDeliberationOutcome({
      deliberationId: "dlb_architecture_0001",
      policy,
      artifacts: changed,
      verificationEvidence: [evidence],
      outcome: outcome({ artifacts: changed, status: "failed" }),
    })).toThrowError(expect.objectContaining({ code: "history_contract_invalid" }));
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

    expect(() => validateDeliberationOutcome({
      deliberationId: "dlb_architecture_0001",
      policy,
      artifacts: changed,
      verificationEvidence: [],
      outcome: outcome({ artifacts: changed, status: "failed" }),
    })).toThrowError(expect.objectContaining({ code: "history_contract_invalid" }));
  });

  it.each([
    ["managed run", (review: DeliberationArtifact, proposal: DeliberationArtifact) => {
      review.producer.runId = proposal.producer.runId;
    }],
    ["provider session", (review: DeliberationArtifact, proposal: DeliberationArtifact) => {
      review.producer.sessionId = proposal.producer.sessionId;
    }],
    ["context receipt", (review: DeliberationArtifact, proposal: DeliberationArtifact) => {
      review.inputContext.injectedReceiptIds = [proposal.inputContext.injectedReceiptIds[0]!];
    }],
  ])("rejects cross-role reuse of a %s", (_name, mutate) => {
    const { artifacts } = convergedHistory();
    const proposal = artifacts[0]!;
    const review = structuredClone(artifacts[1]!) as DeliberationArtifact;
    mutate(review, proposal);
    review.deliberationArtifactId = calculateDeliberationArtifactId(review);
    const changed = [proposal, review];

    expect(() => validateDeliberationOutcome({
      deliberationId: "dlb_architecture_0001",
      policy,
      artifacts: changed,
      verificationEvidence: [],
      outcome: outcome({
        artifacts: changed,
        status: "no_consensus",
        reason: "blocking_objections_unresolved",
      }),
    })).toThrowError(expect.objectContaining({ code: "history_contract_invalid" }));
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

    expect(() => validateDeliberationOutcome({
      deliberationId: "dlb_architecture_0001",
      policy,
      artifacts: changed,
      verificationEvidence: [],
      outcome: outcome({
        artifacts: changed,
        status: "no_consensus",
        reason: "required_verification_not_passed",
      }),
    })).toThrowError(expect.objectContaining({ code: "history_contract_invalid" }));
  });

  it("rejects an approval that points to an older proposal after revision", () => {
    const { artifacts } = convergedHistory();
    const approval = structuredClone(artifacts[3]!) as DeliberationArtifact;
    approval.previousArtifactIds = [artifacts[0]!.deliberationArtifactId];
    approval.deliberationArtifactId = calculateDeliberationArtifactId(approval);
    const changed = [...artifacts.slice(0, 3), approval];

    expect(() => validateDeliberationOutcome({
      deliberationId: "dlb_architecture_0001",
      policy,
      artifacts: changed,
      verificationEvidence: [],
      outcome: outcome({ artifacts: changed, status: "failed" }),
    })).toThrowError(expect.objectContaining({ code: "history_contract_invalid" }));
  });

  it("rejects verification evidence that is not recorded in the artifact history", () => {
    const { artifacts, evidence } = convergedHistory();
    const changed = [artifacts[0]!];

    expect(() => validateDeliberationOutcome({
      deliberationId: "dlb_architecture_0001",
      policy,
      artifacts: changed,
      verificationEvidence: [evidence],
      outcome: outcome({ artifacts: changed, status: "failed" }),
    })).toThrowError(expect.objectContaining({ code: "verification_evidence_invalid" }));
  });

  it("allows a failed outcome before the first artifact is confirmed", () => {
    expect(() => validateDeliberationOutcome({
      deliberationId: "dlb_architecture_0001",
      policy,
      artifacts: [],
      verificationEvidence: [],
      outcome: outcome({ artifacts: [], status: "failed" }),
    })).not.toThrow();
  });

  it("binds a pre-artifact failure to the requested deliberation", () => {
    expect(() => validateDeliberationOutcome({
      deliberationId: "dlb_another_0001",
      policy,
      artifacts: [],
      verificationEvidence: [],
      outcome: outcome({ artifacts: [], status: "failed" }),
    })).toThrowError(expect.objectContaining({ code: "outcome_contract_invalid" }));
  });
});
