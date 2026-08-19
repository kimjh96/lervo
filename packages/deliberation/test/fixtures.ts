import type {
  DeliberationArtifact,
  DeliberationOutcome,
  DeliberationPolicy,
  VerificationCommand,
  VerificationResult,
  VerificationSuite,
  WritingPublicationPermit,
} from "@lervo/schemas";
import {
  calculateVerificationId,
  verificationCommandDigest,
  verificationResultBytes,
  verificationSha256,
  verificationSuiteHash,
} from "@lervo/verification-contract";
import { calculateWritingPublicationPermitId } from "@lervo/writing-contract";

import {
  calculateDeliberationArtifactId,
  calculateDeliberationOutcomeId,
  deliberationPolicyHash,
  deliberationSha256,
  type DeliberationVerificationEvidence,
} from "../src/index.js";

export const policy: DeliberationPolicy = {
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

export const claimId = "clm_architecture_0001";
export const objectionId = "obj_architecture_0001";

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

export function artifact(input: {
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
  const content = `${input.kind}:${input.roleId}:${input.round}:${input.sequence}`;
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
      byteCount: Buffer.byteLength(content),
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

export function convergedHistory(): {
  artifacts: DeliberationArtifact[];
  evidence: DeliberationVerificationEvidence;
} {
  const evidence = verificationEvidence();
  const proposal = artifact({
    kind: "proposal", round: 1, roleId: "architect", sessionId: "ses_architect_0001",
    provider: "codex", previousArtifactIds: [], sequence: 1,
    details: { claims: [{ claimId, claimDigest: deliberationSha256("claim:v1") }] },
  });
  const changesRequested = artifact({
    kind: "objection", round: 1, roleId: "reviewer", sessionId: "ses_reviewer_0001",
    provider: "claude", previousArtifactIds: [proposal.deliberationArtifactId], sequence: 2,
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
    kind: "revision", round: 2, roleId: "architect", sessionId: "ses_architect_0002",
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
    kind: "objection", round: 2, roleId: "reviewer", sessionId: "ses_reviewer_0002",
    provider: "claude", previousArtifactIds: [revision.deliberationArtifactId], sequence: 4,
    details: { reviewStatus: "approved", objections: [] },
  });
  const verification = artifact({
    kind: "verification", round: 2, roleId: "verifier", sessionId: "ses_verifier_0001",
    provider: "claude", previousArtifactIds: [approved.deliberationArtifactId], sequence: 5,
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
    kind: "decision", round: 2, roleId: "lead", sessionId: "ses_lead_0001",
    provider: "codex", previousArtifactIds: [verification.deliberationArtifactId], sequence: 6,
    details: {
      decisionOwnerRoleId: "lead",
      adoptedClaimIds: [claimId],
      verificationArtifactIds: [verification.deliberationArtifactId],
      unresolvedObjectionIds: [],
    },
  });
  return { artifacts: [proposal, changesRequested, revision, approved, verification, decision], evidence };
}

export function outcome(input: {
  artifacts: readonly DeliberationArtifact[];
  status: DeliberationOutcome["status"];
  reason?: "max_rounds_reached" | "blocking_objections_unresolved" |
    "required_verification_not_passed";
  decisionArtifactId?: string | null;
  passedVerificationArtifactIds?: string[];
  unresolvedBlockingObjectionIds?: string[];
}): DeliberationOutcome {
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
    passedVerificationArtifactIds: input.passedVerificationArtifactIds ?? [],
    unresolvedBlockingObjectionIds: input.unresolvedBlockingObjectionIds ?? [],
    completedAt: "2026-08-19T00:00:20Z",
  };
  let value: DeliberationOutcome;
  if (input.status === "converged") {
    value = {
      ...common,
      status: "converged",
      decisionArtifactId: input.decisionArtifactId ?? "dla_0000000000000000",
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
