import type { DecisionTaxonomy } from "@lervo/project";

import { repositoryDocumentScanPriority } from "./document-layout.js";
import {
  agentArtifactFields,
  repositorySourceClassificationForPath,
  repositorySourceKindForPath,
} from "./repository-source-classification.js";
import type { RepositoryScanPriorityClass } from "./types.js";

export const scanPriorityClasses: RepositoryScanPriorityClass[] = [
  "instructions",
  "portable_skills",
  "canonical_documents",
  "source_and_configuration",
  "other_documents",
];

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
  return kind === "documentation" || kind === "log" || kind === "other" || path.startsWith("@")
    ? "other_documents"
    : "source_and_configuration";
}
