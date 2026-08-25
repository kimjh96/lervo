import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createManagedBlockPatchCandidate, parseManagedMarkdownBlocks } from "@lervo/documents";

import { applyDurableKnowledgeOperations } from "./durable-apply.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import type { KnowledgeFileOperation, RepositoryKnowledgeScan } from "./types.js";

export const developmentPatternTargetKinds = [
  "repository_instruction",
  "scoped_instruction",
  "portable_skill",
  "decision",
  "automated_check",
] as const;

export type DevelopmentPatternTargetKind = (typeof developmentPatternTargetKinds)[number];

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
  target: { kind: DevelopmentPatternTargetKind; path: string; content: string };
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
    }
  >;
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

export interface DevelopmentPatternPromotionPlan {
  schemaVersion: 1;
  planKind: "development_pattern_promotion";
  planId: string;
  repositoryRoot: string;
  projectId: string;
  patternId: string;
  candidateContentHash: string;
  reviewContentHash: string;
  sourceSnapshotId: string;
  sourceFreshness: "current" | "stale";
  status: "ready" | "current" | "blocked";
  blockers: string[];
  agentRoutes: Array<{ provider: "codex" | "claude"; path: string; disposition: string }>;
  verificationCommands: string[];
  operations: KnowledgeFileOperation[];
}

const safeRelativePath = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[^\0]+$/u;
const routeBlockId = "development_pattern_routes";

async function readBoundedText(
  repositoryRoot: string,
  path: string,
  maximumBytes: number,
): Promise<{ content: string; contentHash: string } | null> {
  try {
    const content = await readFile(resolve(repositoryRoot, path), "utf8");
    if (Buffer.byteLength(content) > maximumBytes)
      throw new Error("Development-pattern target exceeds the bounded read limit.");
    return { content, contentHash: sha256(content) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

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
          ? /^\.agents\/skills\/[a-z0-9][a-z0-9-]*\/SKILL\.md$/u.test(target.path)
          : target.kind === "decision"
            ? /^docs\/decisions\/[a-z0-9][a-z0-9/-]*\.md$/u.test(target.path)
            : /^scripts\/check-[a-z0-9-]+\.mjs$/u.test(target.path);
  if (!accepted) throw new Error("Development-pattern target path does not match its owner.");
}

function validateProposal(proposal: DevelopmentPatternProposal): void {
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
}

export function createDevelopmentPatternCandidate(input: {
  proposal: DevelopmentPatternProposal;
  scan: RepositoryKnowledgeScan;
}): { candidate: DevelopmentPatternCandidate; content: string; contentHash: string } {
  validateProposal(input.proposal);
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

function routeContent(title: string, targetPath: string): string {
  const label = title.replace(/[[\]]/gu, "");
  return `\n## Promoted development patterns\n\n- [${label}](${targetPath})\n`;
}

async function routeOperation(
  root: string,
  candidate: DevelopmentPatternCandidate,
): Promise<KnowledgeFileOperation | null> {
  if (candidate.target.kind === "automated_check") return null;
  const source = await readFile(resolve(root, "AGENTS.md"), "utf8");
  const sourceHash = sha256(source);
  const parsed = parseManagedMarkdownBlocks(Buffer.from(source));
  if (parsed.status !== "valid") throw new Error("AGENTS managed-block structure is invalid.");
  const desiredRoute = `- [${candidate.title.replace(/[[\]]/gu, "")}](${candidate.target.path})`;
  const block = parsed.blocks.find((item) => item.blockId === routeBlockId);
  let output: string;
  if (block === undefined) {
    output = `${source.replace(/\n*$/u, "\n")}\n<!-- lervo:begin block=${routeBlockId} schema=1 -->${routeContent(candidate.title, candidate.target.path)}<!-- lervo:end block=${routeBlockId} -->\n`;
  } else {
    const current = Buffer.from(source)
      .subarray(block.contentRange.start, block.contentRange.end)
      .toString("utf8");
    if (current.split("\n").includes(desiredRoute)) return null;
    const replacement = `${current.replace(/\n*$/u, "\n")}${desiredRoute}\n`;
    output = Buffer.from(
      createManagedBlockPatchCandidate({
        source: {
          path: "AGENTS.md",
          contentHash: sourceHash,
          byteCount: Buffer.byteLength(source),
          bytes: Buffer.from(source),
        },
        blockId: routeBlockId,
        replacementBytes: Buffer.from(replacement),
      }).outputBytes,
    ).toString("utf8");
  }
  return {
    path: "AGENTS.md",
    action: "update",
    ownership: "managed_blocks",
    mediaType: "text/markdown",
    content: output,
    expectedCurrentHash: sourceHash,
    desiredHash: sha256(output),
    reason: "promoted_pattern_agent_route",
  };
}

export async function createDevelopmentPatternPromotionPlan(input: {
  repositoryRoot: string;
  projectId: string;
  candidate: DevelopmentPatternCandidate;
  candidateContentHash: string;
  review: DevelopmentPatternReview;
  reviewContentHash: string;
  currentScan: RepositoryKnowledgeScan;
}): Promise<DevelopmentPatternPromotionPlan> {
  const blockers: string[] = [];
  if (input.review.decision !== "accept") blockers.push("pattern_not_accepted");
  if (input.review.candidateContentHash !== input.candidateContentHash)
    blockers.push("review_candidate_mismatch");
  const sourceFreshness =
    input.currentScan.contentSnapshotId === input.candidate.sourceSnapshotId ? "current" : "stale";
  const currentTarget = await readBoundedText(
    input.repositoryRoot,
    input.candidate.target.path,
    128 * 1024,
  );
  const desiredHash = sha256(input.candidate.target.content);
  if (currentTarget !== null && currentTarget.contentHash !== desiredHash)
    blockers.push("target_conflict");
  const targetOperation: KnowledgeFileOperation = {
    path: input.candidate.target.path,
    action: currentTarget === null ? "create" : "unchanged",
    ownership: "lervo_generated",
    mediaType: input.candidate.target.path.endsWith(".md") ? "text/markdown" : "text/javascript",
    ...(currentTarget === null ? { content: input.candidate.target.content } : {}),
    ...(currentTarget === null ? {} : { expectedCurrentHash: currentTarget.contentHash }),
    desiredHash,
    reason: `promoted_pattern_${input.candidate.target.kind}`,
  };
  const route = await routeOperation(input.repositoryRoot, input.candidate);
  const operations = [targetOperation, ...(route === null ? [] : [route])];
  const changed = operations.some((item) => item.action !== "unchanged");
  if (sourceFreshness === "stale" && changed) blockers.push("source_snapshot_changed");
  const planId = stableId("kpatternplan", {
    projectId: input.projectId,
    patternId: input.candidate.patternId,
    candidateContentHash: input.candidateContentHash,
    reviewContentHash: input.reviewContentHash,
    blockers,
    operations,
  });
  return {
    schemaVersion: 1,
    planKind: "development_pattern_promotion",
    planId,
    repositoryRoot: resolve(input.repositoryRoot),
    projectId: input.projectId,
    patternId: input.candidate.patternId,
    candidateContentHash: input.candidateContentHash,
    reviewContentHash: input.reviewContentHash,
    sourceSnapshotId: input.candidate.sourceSnapshotId,
    sourceFreshness,
    status: blockers.length > 0 ? "blocked" : changed ? "ready" : "current",
    blockers,
    agentRoutes:
      input.candidate.target.kind === "automated_check"
        ? []
        : [
            { provider: "codex", path: "AGENTS.md", disposition: "managed_route" },
            { provider: "claude", path: "CLAUDE.md", disposition: "imports_agents_route" },
          ],
    verificationCommands: input.candidate.verificationCommands,
    operations,
  };
}

export function publicDevelopmentPatternPromotionPlan(plan: DevelopmentPatternPromotionPlan) {
  return {
    ...plan,
    operations: plan.operations.map(({ content: _content, ...operation }) => operation),
  };
}

export async function applyDevelopmentPatternPromotion<T>(input: {
  plan: DevelopmentPatternPromotionPlan;
  approval: string;
  receipt: T;
  recordApplied: (receipt: T) => void | Promise<void>;
}): Promise<T> {
  if (input.plan.status === "blocked") throw new Error("Development-pattern promotion is blocked.");
  if (input.approval !== input.plan.planId)
    throw new Error("Approval must equal the exact development-pattern promotion plan ID.");
  return applyDurableKnowledgeOperations({
    repositoryRoot: input.plan.repositoryRoot,
    projectId: input.plan.projectId,
    planId: input.plan.planId,
    operations: input.plan.operations,
    receipt: input.receipt,
    recordApplied: input.recordApplied,
  });
}
