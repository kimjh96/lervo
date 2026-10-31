import {
  canonicalJson,
  practicePublicPath,
  sanitizePracticeText,
} from "@lervo/repository-knowledge";
import { repositoryPathWithinScope } from "@lervo/work-controller";
import { disclosePracticeWork } from "./practice-disclosure.js";
import type { PracticeCatalog } from "./practice-catalog.js";
import type { PracticeEvidence } from "./practice-state.js";

/** Revocation blocks disclosure of the original hash-bound bundle; it never silently rebinds review. */
export function assertPracticeEvidenceDisclosure(
  evidence: PracticeEvidence[],
  catalog: Pick<PracticeCatalog, "readRoots" | "readablePaths">,
): void {
  const allowed = (path: string) =>
    practicePublicPath(path) &&
    catalog.readRoots.some((root) => repositoryPathWithinScope(path, root)) &&
    catalog.readablePaths.includes(path);
  for (const bundle of evidence) {
    if (
      canonicalJson(bundle.work) !==
        canonicalJson(
          disclosePracticeWork(bundle.work, catalog.readRoots, catalog.readablePaths),
        ) ||
      bundle.procedure.sourcePaths.some((path) => !allowed(path)) ||
      bundle.excerpts.some((excerpt) => !allowed(excerpt.path)) ||
      sanitizePracticeText(canonicalJson(bundle)) !== canonicalJson(bundle)
    )
      throw new Error("source_incomplete");
  }
}
