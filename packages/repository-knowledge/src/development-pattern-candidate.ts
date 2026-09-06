import { canonicalJson, sha256, stableId } from "./integrity.js";
import {
  assertAgentProfilePattern,
  type AgentProfileEvidenceReference,
  type AgentProfileTarget,
  type RoleProfileActivationEvidence,
} from "./agent-profile-pattern.js";
import {
  createPortableSkillPackageCandidate,
  type PassedWorkflowVerificationEvidence,
  type PortableSkillContractProposal,
  type PortableSkillPackageCandidate,
  type WorkflowVerificationReference,
} from "./portable-skill-pattern.js";
import type { RepositoryKnowledgeScan } from "./types.js";

export type {
  PassedWorkflowVerificationEvidence,
  PortableSkillContractProposal,
  PortableSkillPackageCandidate,
  PortableSkillResourceProposal,
  WorkflowVerificationReference,
} from "./portable-skill-pattern.js";

export const developmentPatternTargetKinds = [
  "repository_instruction",
  "scoped_instruction",
  "portable_skill",
  "decision",
  "automated_check",
  "agent_profile",
] as const;

export type DevelopmentPatternTargetKind = (typeof developmentPatternTargetKinds)[number];

export type DevelopmentPatternTarget =
  | {
      kind: Exclude<DevelopmentPatternTargetKind, "agent_profile">;
      path: string;
      content: string;
      expectedCurrentHash?: never;
    }
  | AgentProfileTarget;

export interface DevelopmentPatternProposal {
  schemaVersion: 1;
  title: string;
  summary: string;
  scope: string;
  occurrences: Array<{ path: string; locator: string; independentGroup: string }>;
  exceptions: string[];
  affectedInvariants: string[];
  reasonsToChange: string[];
  verificationCommands: string[];
  target: DevelopmentPatternTarget;
  workflowVerification?: WorkflowVerificationReference[];
  portableSkillContract?: PortableSkillContractProposal;
  agentProfileEvidence?: AgentProfileEvidenceReference[];
}

export interface DevelopmentPatternCandidate extends DevelopmentPatternProposal {
  patternId: string;
  sourceSnapshotId: string;
  sourceSnapshotHash: string;
  occurrences: Array<
    DevelopmentPatternProposal["occurrences"][number] & {
      unitId: string;
      unitVersionId: string;
      evidenceDigest: string;
      sourceHash?: string;
      unitHash?: string;
    }
  >;
  portableSkillPackage?: PortableSkillPackageCandidate;
}

export interface DevelopmentPatternReview {
  schemaVersion: 1;
  patternId: string;
  candidateContentHash: string;
  decision: "accept" | "reject" | "defer" | "supersede";
  reviewer: string;
  supersededByPatternId: string | null;
  reviewedAt: string;
}

const safeRelativePath = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[^\0]+$/u;
function boundedStrings(
  values: unknown,
  field: string,
  maximum: number,
): asserts values is string[] {
  if (
    !Array.isArray(values) ||
    values.length > maximum ||
    values.some((value) => typeof value !== "string" || value.length === 0 || value.length > 512)
  )
    throw new Error(`${field} must contain bounded non-empty strings.`);
}

function validateTarget(target: DevelopmentPatternProposal["target"]): void {
  if (!developmentPatternTargetKinds.includes(target.kind))
    throw new Error("Unsupported development-pattern target kind.");
  if (
    !safeRelativePath.test(target.path) ||
    target.content.length === 0 ||
    target.content.length > 64_000
  )
    throw new Error("Development-pattern target coordinates are unsafe or unbounded.");
  const accepted =
    target.kind === "repository_instruction"
      ? /^docs\/(?:foundation|instructions)\/[a-z0-9][a-z0-9/-]*\.md$/u.test(target.path)
      : target.kind === "scoped_instruction"
        ? /^docs\/instructions\/[a-z0-9][a-z0-9/-]*\.md$/u.test(target.path)
        : target.kind === "portable_skill"
          ? /^\.agents\/skills\/[a-z][a-z0-9-]*\/SKILL\.md$/u.test(target.path)
          : target.kind === "decision"
            ? /^docs\/decisions\/[a-z0-9][a-z0-9/-]*\.md$/u.test(target.path)
            : target.kind === "automated_check"
              ? /^scripts\/check-[a-z0-9-]+\.mjs$/u.test(target.path)
              : /^\.lervo\/roles\/[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*\.json$/u.test(target.path);
  if (!accepted) throw new Error("Development-pattern target path does not match its owner.");
}

function validateProposal(input: {
  proposal: DevelopmentPatternProposal;
  passedVerificationEvidence: readonly PassedWorkflowVerificationEvidence[];
  roleProfileActivationEvidence: readonly RoleProfileActivationEvidence[];
}): PortableSkillPackageCandidate | undefined {
  const proposal = input.proposal;
  if (
    proposal.schemaVersion !== 1 ||
    proposal.title.length === 0 ||
    proposal.title.length > 160 ||
    /[\r\n]/u.test(proposal.title) ||
    proposal.summary.length === 0 ||
    proposal.summary.length > 2_000 ||
    proposal.scope.length === 0 ||
    proposal.scope.length > 256 ||
    !Array.isArray(proposal.occurrences) ||
    proposal.occurrences.length < 2 ||
    proposal.occurrences.length > 64
  )
    throw new Error("Development-pattern proposal does not satisfy the bounded v1 contract.");
  const independent = new Set<string>();
  for (const occurrence of proposal.occurrences) {
    if (
      !safeRelativePath.test(occurrence.path) ||
      occurrence.locator.length === 0 ||
      occurrence.locator.length > 256 ||
      occurrence.independentGroup.length === 0 ||
      occurrence.independentGroup.length > 128
    )
      throw new Error("Development-pattern occurrence is unsafe or unbounded.");
    independent.add(occurrence.independentGroup);
  }
  if (independent.size < 2)
    throw new Error("A pattern requires at least two independent occurrences.");
  boundedStrings(proposal.exceptions, "exceptions", 32);
  boundedStrings(proposal.affectedInvariants, "affectedInvariants", 32);
  boundedStrings(proposal.reasonsToChange, "reasonsToChange", 32);
  boundedStrings(proposal.verificationCommands, "verificationCommands", 16);
  if (proposal.affectedInvariants.length === 0 || proposal.reasonsToChange.length === 0)
    throw new Error("A pattern requires affected invariants and reasons to change.");
  validateTarget(proposal.target);

  if (proposal.target.kind === "agent_profile") {
    if (proposal.portableSkillContract !== undefined)
      throw new Error("An agent-profile candidate cannot include a portable-skill contract.");
    assertAgentProfilePattern({
      target: proposal.target,
      independentGroups: independent,
      evidence: proposal.agentProfileEvidence,
      passedVerificationEvidence: input.passedVerificationEvidence,
      activationEvidence: input.roleProfileActivationEvidence,
    });
  } else if (proposal.agentProfileEvidence !== undefined) {
    throw new Error("Agent-profile evidence is valid only for an agent-profile target.");
  }

  return createPortableSkillPackageCandidate({
    target: proposal.target,
    independentGroups: independent,
    verification: proposal.workflowVerification,
    contract: proposal.portableSkillContract,
    passedVerificationEvidence: input.passedVerificationEvidence,
  });
}

export function parseDevelopmentPatternProposal(value: unknown): DevelopmentPatternProposal {
  const proposal = value as DevelopmentPatternProposal;
  validateProposal({
    proposal,
    passedVerificationEvidence: [
      ...(proposal?.workflowVerification ?? []),
      ...(proposal?.agentProfileEvidence?.map((item) => item.verification) ?? []),
    ],
    roleProfileActivationEvidence:
      proposal?.agentProfileEvidence?.map((item) => item.activation) ?? [],
  });
  return structuredClone(proposal);
}

export function createDevelopmentPatternCandidate(input: {
  proposal: DevelopmentPatternProposal;
  scan: RepositoryKnowledgeScan;
  passedVerificationEvidence?: readonly PassedWorkflowVerificationEvidence[];
  roleProfileActivationEvidence?: readonly RoleProfileActivationEvidence[];
}): { candidate: DevelopmentPatternCandidate; content: string; contentHash: string } {
  const portableSkillPackage = validateProposal({
    proposal: input.proposal,
    passedVerificationEvidence: input.passedVerificationEvidence ?? [],
    roleProfileActivationEvidence: input.roleProfileActivationEvidence ?? [],
  });
  const occurrences = input.proposal.occurrences.map((occurrence) => {
    const units = input.scan.units.filter(
      (unit) => unit.path === occurrence.path && unit.locator === occurrence.locator,
    );
    if (units.length !== 1)
      throw new Error("Each pattern occurrence must resolve to one current source unit.");
    const unit = units[0]!;
    return {
      ...occurrence,
      unitId: unit.unitId,
      unitVersionId: unit.unitVersionId,
      evidenceDigest: sha256(
        canonicalJson({
          unitVersionId: unit.unitVersionId,
          independentGroup: occurrence.independentGroup,
        }),
      ),
      ...(portableSkillPackage === undefined
        ? {}
        : { sourceHash: unit.sourceHash, unitHash: unit.unitHash }),
    };
  });
  const sourceSnapshotHash = sha256(
    canonicalJson({ snapshotId: input.scan.contentSnapshotId, occurrences }),
  );
  const identity = {
    ...input.proposal,
    occurrences,
    sourceSnapshotId: input.scan.contentSnapshotId,
    sourceSnapshotHash,
    ...(portableSkillPackage === undefined ? {} : { portableSkillPackage }),
  };
  const patternId = stableId("pattern", identity);
  const candidate: DevelopmentPatternCandidate = { ...identity, patternId };
  const content = `${canonicalJson(candidate)}\n`;
  return { candidate, content, contentHash: sha256(content) };
}

export function createDevelopmentPatternReview(input: {
  patternId: string;
  candidateContentHash: string;
  decision: DevelopmentPatternReview["decision"];
  reviewer: string;
  supersededByPatternId?: string;
  reviewedAt: string;
}): { review: DevelopmentPatternReview; content: string; contentHash: string } {
  if (
    !/^pattern_[a-f0-9]{24}$/u.test(input.patternId) ||
    !/^sha256:[a-f0-9]{64}$/u.test(input.candidateContentHash)
  )
    throw new Error("Development-pattern review coordinates are invalid.");
  if (input.reviewer.length < 3 || input.reviewer.length > 128)
    throw new Error("Development-pattern reviewer is invalid.");
  const supersededByPatternId = input.supersededByPatternId ?? null;
  if (
    input.decision === "supersede" ? supersededByPatternId === null : supersededByPatternId !== null
  )
    throw new Error("Only a supersede review may name the replacement pattern.");
  if (
    supersededByPatternId !== null &&
    (!/^pattern_[a-f0-9]{24}$/u.test(supersededByPatternId) ||
      supersededByPatternId === input.patternId)
  )
    throw new Error("A superseding pattern coordinate must name a distinct pattern.");
  const review: DevelopmentPatternReview = {
    schemaVersion: 1,
    patternId: input.patternId,
    candidateContentHash: input.candidateContentHash,
    decision: input.decision,
    reviewer: input.reviewer,
    supersededByPatternId,
    reviewedAt: input.reviewedAt,
  };
  const content = `${canonicalJson(review)}\n`;
  return { review, content, contentHash: sha256(content) };
}
