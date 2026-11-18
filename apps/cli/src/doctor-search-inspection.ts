import type { SearchCandidateEngineResolver, ProductDefaultSearchEngine } from "@lervo/search";
import { inspectOperationalSearchEngine } from "@lervo/search-local";
import type { DoctorInspection } from "@lervo/diagnostics";

import { doctorInspection, doctorIssue } from "./doctor-inspection-result.js";

function invalidSelection(observedCount = 0): DoctorInspection {
  return doctorInspection("search_engine_selection", "unhealthy", observedCount, [
    doctorIssue(
      "search_engine_selection_invalid",
      "Could not safely resolve the current search engine.",
    ),
  ]);
}

export async function inspectDoctorSearch(input: {
  repositoryRoot: string;
  projectId: string;
  registry: SearchCandidateEngineResolver;
  productDefault?: ProductDefaultSearchEngine;
  observedAt: Date;
}): Promise<DoctorInspection[]> {
  try {
    const result = await inspectOperationalSearchEngine(input);
    return [
      result.resolverState === "ready"
        ? doctorInspection("search_engine_selection", "healthy", 0)
        : invalidSelection(),
    ];
  } catch {
    return [invalidSelection()];
  }
}
