import type { DecisionTaxonomy } from "@lervo/project";

import {
  lintDocumentReferences,
  currentMarkdownDocumentSources,
  MAXIMUM_REFERENCE_FINDINGS_PER_CODE,
  referenceTargetIgnored,
  repositoryPathOracle,
} from "./document-reference-lint.js";
import type { DocumentStalenessReport } from "./document-staleness-evaluation.js";
import { gitDocumentStalenessPort } from "./document-staleness-git.js";
import {
  observeRepositoryDocumentStaleness,
  type DocumentStalenessObservationMode,
} from "./document-staleness-state.js";
import { scanRetentionDigest } from "./scan-retention.js";
import type {
  KnowledgeLintIssue,
  KnowledgeLintResult,
  RepositoryKnowledgePolicy,
  RepositoryKnowledgeScan,
} from "./types.js";

export type DocumentStalenessLintMode = DocumentStalenessObservationMode | "skip";

const MAXIMUM_LISTED_CHANGED_PATHS = 5;

function staleIssue(finding: DocumentStalenessReport["stale"][number]): KnowledgeLintIssue {
  const listed = finding.changedPaths.slice(0, MAXIMUM_LISTED_CHANGED_PATHS);
  const more = finding.changedPaths.length - listed.length;
  const changed =
    listed.length === 0
      ? ""
      : ` Changed connected paths: ${listed.join(", ")}${more > 0 ? ` and ${more} more` : ""}.`;
  return {
    code: "document_stale",
    severity: "warning",
    path: finding.path,
    ...(listed[0] === undefined ? {} : { target: listed[0] }),
    reasons: finding.reasons,
    message: `The document is stale against its verified revision ${finding.verifiedRevision?.slice(0, 12) ?? "unknown"} (${finding.reasons.join(", ")}).${changed}`,
  };
}

export function documentStalenessLintIssues(report: DocumentStalenessReport): KnowledgeLintIssue[] {
  if (report.status !== "observed") return [];
  const issues = report.stale.slice(0, MAXIMUM_REFERENCE_FINDINGS_PER_CODE).map(staleIssue);
  const omitted = report.counts.stale - issues.length;
  if (omitted > 0)
    issues.push({
      code: "document_reference_findings_truncated",
      severity: "warning",
      path: ".",
      reasons: ["document_stale"],
      message: `${omitted} additional document_stale findings were omitted from this bounded report.`,
    });
  if (report.counts.unknown > 0)
    issues.push({
      code: "document_staleness_unknown",
      severity: "warning",
      path: ".",
      reasons: [...new Set(report.unknown.flatMap((finding) => finding.reasons))].sort(),
      message: `${report.counts.unknown} documents with connected paths have unknown staleness; unknown is not current.`,
    });
  return issues;
}

/** Document drift findings for `lervo knowledge lint`: references, role targets, and staleness. */
export async function lintDocumentDrift(input: {
  root: string;
  scan: RepositoryKnowledgeScan;
  policy: RepositoryKnowledgePolicy;
  generatedPaths: ReadonlySet<string>;
  taxonomy: DecisionTaxonomy | null;
  normalizationRecords: ReadonlyArray<{ path: string; outputPaths: readonly string[] }>;
  staleness: DocumentStalenessLintMode;
  now?: Date;
}): Promise<{
  issues: KnowledgeLintIssue[];
  documentStaleness: KnowledgeLintResult["documentStaleness"];
}> {
  const issues = await lintDocumentReferences(input);
  if (input.staleness === "skip") return { issues, documentStaleness: undefined };
  const oracle = repositoryPathOracle(input.root, input.scan);
  const report = await observeRepositoryDocumentStaleness({
    root: input.root,
    coverage: input.scan.coverage,
    retentionDigest: scanRetentionDigest(input.scan),
    mode: input.staleness,
    documents: currentMarkdownDocumentSources(input.scan, input.taxonomy).map((source) => ({
      path: source.path,
      content: source.content!,
    })),
    normalizationRecords: input.normalizationRecords,
    ignored: (target) =>
      referenceTargetIgnored({
        target,
        policy: input.policy,
        generatedPaths: input.generatedPaths,
      }),
    topLevel: oracle.topLevel,
    git: gitDocumentStalenessPort(input.root),
    now: input.now ?? new Date(),
  });
  return {
    issues: [...issues, ...documentStalenessLintIssues(report)],
    documentStaleness: {
      coverage: report.coverage,
      status: report.status,
      currentRevision: report.currentRevision,
      ...report.counts,
    },
  };
}
