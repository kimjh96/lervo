import type { DecisionTaxonomy } from "@lervo/project";

import { repositoryDocumentScanPriority } from "./document-layout.js";
import {
  agentArtifactFields,
  repositorySourceClassificationForPath,
  repositorySourceKindForPath,
} from "./repository-source-classification.js";
import type { RepositoryScanPriorityClass } from "./types.js";

/** Retention order (ADR-0544): documents precede code, and Lervo's own evidence is always last. */
export const scanPriorityClasses: RepositoryScanPriorityClass[] = [
  "instructions",
  "portable_skills",
  "canonical_documents",
  "other_documents",
  "source_and_configuration",
  "execution_evidence",
];

/** Classes 1–4: a complete scan retains every source in them, so document readers see them all. */
export function knowledgeScanPriorityClass(value: RepositoryScanPriorityClass): boolean {
  return (
    scanPriorityClasses.indexOf(value) < scanPriorityClasses.indexOf("source_and_configuration")
  );
}

/** Code-point admission order is independent of host locale. Paths use slash separators. */
export function compareScanPaths(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0)!);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0)!);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index++) {
    const difference = leftPoints[index]! - rightPoints[index]!;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

export function repositoryScanPriority(
  path: string,
  taxonomy: DecisionTaxonomy,
): RepositoryScanPriorityClass {
  if (/^@(?:event|verification)\//u.test(path)) return "execution_evidence";
  const artifact = agentArtifactFields(path).agentArtifact;
  if (
    artifact?.migrationDisposition === "portable_skill" ||
    artifact?.migrationDisposition === "portable_skill_resource"
  )
    return "portable_skills";
  const kind = repositorySourceKindForPath(path);
  if (artifact !== undefined || kind === "instruction") return "instructions";
  const documentPriority = repositoryDocumentScanPriority(path, taxonomy);
  if (documentPriority !== null) return documentPriority;
  if (repositorySourceClassificationForPath(path) === "sensitive") return "other_documents";
  // Markdown under a test or schema path is still a document: its readers require its text.
  return kind === "documentation" ||
    kind === "log" ||
    kind === "other" ||
    path.startsWith("@") ||
    /\.mdx?$/iu.test(path)
    ? "other_documents"
    : "source_and_configuration";
}
