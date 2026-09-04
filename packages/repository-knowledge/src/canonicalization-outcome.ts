import {
  canonicalResponsibilityForPath,
  sourceResponsibilityForPath,
} from "./canonicalization-responsibility.js";
import { sha256 } from "./integrity.js";
import { RepositoryKnowledgeError } from "./types.js";

interface CanonicalizationOutcomeBase {
  schemaVersion: 1;
  summary: string;
}

export interface NoDurableChangeOutcome extends CanonicalizationOutcomeBase {
  kind: "no_durable_change";
  reasonCode: "implementation_only" | "verification_only" | "already_canonical" | "transient";
  sourcePaths: string[];
}

export interface CanonicalUpdateOutcome extends CanonicalizationOutcomeBase {
  kind: "canonical_update";
  targets: Array<{ path: string; contentHash: string; sourcePaths: string[] }>;
}

export interface CanonicalReviewDraftOutcome extends CanonicalizationOutcomeBase {
  kind: "review_draft";
  drafts: Array<{
    targetPath: string;
    sourcePaths: string[];
    proposedMarkdown: string;
    proposedContentHash: string;
  }>;
}

export type CanonicalizationOutcome =
  NoDurableChangeOutcome | CanonicalUpdateOutcome | CanonicalReviewDraftOutcome;

const HASH = /^sha256:[a-f0-9]{64}$/u;
const MAXIMUM_OUTCOME_TARGETS = 8;
const MAXIMUM_OUTCOME_SOURCE_PATHS = 256;
const MAXIMUM_PROPOSED_BYTES = 12 * 1024;

function safePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").some((part) => part.length === 0 || part === "." || part === "..")
  );
}

function validSourcePaths(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAXIMUM_OUTCOME_SOURCE_PATHS &&
    value.every(safePath) &&
    new Set(value).size === value.length
  );
}

function validSummary(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Buffer.byteLength(value) <= 512 &&
    !value.includes("\0")
  );
}

export function parseCanonicalizationOutcome(value: unknown): CanonicalizationOutcome {
  const outcome = value as Partial<CanonicalizationOutcome> | null;
  const baseValid =
    outcome !== null &&
    typeof outcome === "object" &&
    outcome.schemaVersion === 1 &&
    validSummary(outcome.summary);
  const noDurableValid =
    baseValid &&
    outcome.kind === "no_durable_change" &&
    ["implementation_only", "verification_only", "already_canonical", "transient"].includes(
      outcome.reasonCode ?? "",
    ) &&
    validSourcePaths(outcome.sourcePaths);
  const canonicalUpdateValid =
    baseValid &&
    outcome.kind === "canonical_update" &&
    Array.isArray(outcome.targets) &&
    outcome.targets.length > 0 &&
    outcome.targets.length <= MAXIMUM_OUTCOME_TARGETS &&
    outcome.targets.every(
      (target) =>
        safePath(target.path) &&
        canonicalResponsibilityForPath(target.path) !== null &&
        typeof target.contentHash === "string" &&
        HASH.test(target.contentHash) &&
        validSourcePaths(target.sourcePaths),
    ) &&
    new Set(outcome.targets.map((target) => target.path)).size === outcome.targets.length;
  const reviewDraftValid =
    baseValid &&
    outcome.kind === "review_draft" &&
    Array.isArray(outcome.drafts) &&
    outcome.drafts.length > 0 &&
    outcome.drafts.length <= MAXIMUM_OUTCOME_TARGETS &&
    outcome.drafts.every(
      (draft) =>
        safePath(draft.targetPath) &&
        canonicalResponsibilityForPath(draft.targetPath) !== null &&
        validSourcePaths(draft.sourcePaths) &&
        typeof draft.proposedMarkdown === "string" &&
        draft.proposedMarkdown.trim().length > 0 &&
        Buffer.byteLength(draft.proposedMarkdown) <= MAXIMUM_PROPOSED_BYTES &&
        typeof draft.proposedContentHash === "string" &&
        HASH.test(draft.proposedContentHash) &&
        sha256(draft.proposedMarkdown) === draft.proposedContentHash,
    ) &&
    new Set(outcome.drafts.map((draft) => draft.targetPath)).size === outcome.drafts.length;
  if (!noDurableValid && !canonicalUpdateValid && !reviewDraftValid)
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "The canonicalization outcome is invalid or exceeds its bounded contract.",
    );
  return outcome as CanonicalizationOutcome;
}

function sameMembers(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.toSorted().every((item, index) => item === right.toSorted()[index])
  );
}

export function validateCanonicalizationOutcomeForChange(input: {
  outcome: CanonicalizationOutcome;
  disposition: "canonical_sources_current" | "canonical_sources_updated" | "pending_user_approval";
  beforeFiles: Readonly<Record<string, string>>;
  afterFiles: Readonly<Record<string, string>>;
}): void {
  const outcome = parseCanonicalizationOutcome(input.outcome);
  const expectedKind =
    input.disposition === "canonical_sources_updated"
      ? "canonical_update"
      : input.disposition === "pending_user_approval"
        ? "review_draft"
        : "no_durable_change";
  if (outcome.kind !== expectedKind)
    throw new RepositoryKnowledgeError(
      "knowledge_approval_required",
      `The ${input.disposition} disposition requires a ${expectedKind} outcome.`,
    );
  const changedPaths = [
    ...new Set([...Object.keys(input.beforeFiles), ...Object.keys(input.afterFiles)]),
  ]
    .filter((path) => input.beforeFiles[path] !== input.afterFiles[path])
    .toSorted();
  const expectedSources = changedPaths.filter(
    (path) =>
      sourceResponsibilityForPath(path) !== null && canonicalResponsibilityForPath(path) === null,
  );
  const boundSources =
    outcome.kind === "no_durable_change"
      ? outcome.sourcePaths
      : outcome.kind === "canonical_update"
        ? outcome.targets.flatMap((target) => target.sourcePaths)
        : outcome.drafts.flatMap((draft) => draft.sourcePaths);
  if (
    new Set(boundSources).size !== boundSources.length ||
    !sameMembers(boundSources, expectedSources)
  )
    throw new RepositoryKnowledgeError(
      "knowledge_approval_required",
      "The canonicalization outcome must bind every changed noncanonical source exactly once.",
    );
  if (outcome.kind === "canonical_update") {
    for (const target of outcome.targets) {
      if (
        input.afterFiles[target.path] !== target.contentHash ||
        input.beforeFiles[target.path] === input.afterFiles[target.path]
      )
        throw new RepositoryKnowledgeError(
          "knowledge_plan_stale",
          "A declared canonical target is not an exact changed repository file.",
        );
      const targetResponsibility = canonicalResponsibilityForPath(target.path);
      if (
        target.sourcePaths.some(
          (path) => sourceResponsibilityForPath(path) !== targetResponsibility,
        )
      )
        throw new RepositoryKnowledgeError(
          "knowledge_approval_required",
          "A canonical target does not match the responsibility of its bound sources.",
        );
    }
  }
  if (outcome.kind === "review_draft") {
    for (const draft of outcome.drafts) {
      const targetResponsibility = canonicalResponsibilityForPath(draft.targetPath);
      if (
        draft.sourcePaths.some((path) => sourceResponsibilityForPath(path) !== targetResponsibility)
      )
        throw new RepositoryKnowledgeError(
          "knowledge_approval_required",
          "A proposed canonical target does not match the responsibility of its bound sources.",
        );
    }
  }
}
