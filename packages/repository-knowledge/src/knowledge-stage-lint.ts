import { requireCompleteRepositoryKnowledgeCoverage } from "./scan-completeness.js";
import {
  RepositoryKnowledgeError,
  type KnowledgeLintIssue,
  type KnowledgeLintResult,
} from "./types.js";

export const structuralKnowledgeLintCodes = new Set([
  "generated_output_modified",
  "generated_output_outside_repository",
  "invalid_concept",
  "invalid_generation_manifest",
  "publication_language_mismatch",
  "publication_missing",
  "publication_outside_repository",
  "publication_path_conflict",
  "publication_size_exceeded",
]);

export const normalizationKnowledgeLintCodes = new Set([
  "document_rewrite_ownership_conflict",
  "invalid_document_normalization_record",
]);

export const instructionBridgeKnowledgeLintCodes = new Set([
  ...structuralKnowledgeLintCodes,
  "instruction_bridge_binding_stale",
  "instruction_bridge_target_invalid",
  "invalid_instruction_bridge_record",
]);

export const repositoryLayoutKnowledgeLintCodes = new Set([
  ...instructionBridgeKnowledgeLintCodes,
  ...normalizationKnowledgeLintCodes,
  "ungrouped_decision_document",
]);

function issueCoordinate(issue: KnowledgeLintIssue): string {
  return `${issue.code}:${issue.path}`;
}

function linkCoordinate(issue: KnowledgeLintIssue): string {
  return `${issue.path}\0${issue.target ?? ""}`;
}

function linksTruncated(result: KnowledgeLintResult): boolean {
  return result.issues.some(
    (issue) =>
      issue.code === "document_reference_findings_truncated" &&
      issue.reasons?.includes("markdown_link_target_missing") === true,
  );
}

/** Links broken after a content rewrite in a written document that were not broken before it. */
function newlyBrokenLinks(input: {
  before: KnowledgeLintResult;
  after: KnowledgeLintResult;
  rejectNewBrokenLinksIn?: ReadonlySet<string>;
}): KnowledgeLintIssue[] {
  const written = input.rejectNewBrokenLinksIn;
  if (written === undefined || written.size === 0) return [];
  if (linksTruncated(input.before) || linksTruncated(input.after)) return [];
  const before = new Set(
    input.before.issues
      .filter((issue) => issue.code === "markdown_link_target_missing")
      .map((issue) => linkCoordinate(issue)),
  );
  return input.after.issues.filter(
    (issue) =>
      issue.code === "markdown_link_target_missing" &&
      written.has(issue.path) &&
      !before.has(linkCoordinate(issue)),
  );
}

/**
 * A content rewrite broke links it did not break before. The stage's bytes are rolled back like any
 * other blocking finding; the caller settles the rewrite as rejected instead of retrying it.
 */
export class KnowledgeStageBrokenLinkError extends RepositoryKnowledgeError {
  readonly links: ReadonlyArray<{ path: string; target: string }>;

  constructor(stage: string, issues: readonly KnowledgeLintIssue[]) {
    const links = issues.map((issue) => ({ path: issue.path, target: issue.target ?? "" }));
    super(
      "knowledge_lint_failed",
      `Deterministic lint failed after ${stage}. Materialized bytes were rejected and rolled back. The rewrite broke ${links.length} Markdown link(s): ${links
        .slice(0, 20)
        .map((link) => `${link.path} -> ${link.target}`)
        .join(", ")}`,
    );
    this.links = links;
  }
}

export function validateKnowledgeStage(input: {
  stage: string;
  before: KnowledgeLintResult;
  after: KnowledgeLintResult;
  ownedErrorCodes: ReadonlySet<string>;
  expectedTransitionCodes?: ReadonlySet<string>;
  /**
   * Documents a content-rewriting stage wrote in place. A Markdown link it newly broke in one of
   * them is rejected with `KnowledgeStageBrokenLinkError`. Broken links are warnings, so the error
   * rule alone let a background normalization commit two of them (core-loop host defect 4). A
   * stage that moves documents passes nothing, because a moved document's existing broken link
   * reappears under its new path. A truncated link report on either side disables the check, since
   * a link cut from the earlier report would otherwise look new.
   */
  rejectNewBrokenLinksIn?: ReadonlySet<string>;
}): KnowledgeLintResult {
  requireCompleteRepositoryKnowledgeCoverage(input.before);
  requireCompleteRepositoryKnowledgeCoverage(input.after);
  const beforeErrors = new Set(
    input.before.issues
      .filter((issue) => issue.severity === "error")
      .map((issue) => issueCoordinate(issue)),
  );
  const expectedTransitions = input.expectedTransitionCodes ?? new Set<string>();
  const blocking = input.after.issues.filter(
    (issue) =>
      issue.severity === "error" &&
      !expectedTransitions.has(issue.code) &&
      (input.ownedErrorCodes.has(issue.code) || !beforeErrors.has(issueCoordinate(issue))),
  );
  const brokenLinks = newlyBrokenLinks(input);
  if (blocking.length === 0 && brokenLinks.length > 0)
    throw new KnowledgeStageBrokenLinkError(input.stage, brokenLinks);
  if (blocking.length > 0) {
    const summary = blocking
      .slice(0, 20)
      .map((issue) => issueCoordinate(issue))
      .join(", ");
    throw new RepositoryKnowledgeError(
      "knowledge_lint_failed",
      `Deterministic lint failed after ${input.stage}. Materialized bytes were rejected and rolled back. Blocking findings observed before rollback: ${summary}`,
    );
  }
  const issues = input.after.issues.map((issue) => {
    if (issue.severity !== "error") return issue;
    const expected = expectedTransitions.has(issue.code);
    if (!expected && !beforeErrors.has(issueCoordinate(issue))) return issue;
    return {
      ...issue,
      severity: "warning" as const,
      message: `${issue.message} ${
        expected
          ? "Expected until the next ordered lifecycle stage."
          : "This pre-existing issue is retained for a later lifecycle stage."
      }`,
    };
  });
  return { ...input.after, valid: true, issues };
}
