import type { SearchSelectionQualityReport } from "@lervo/search";

import { loadVerifiedSearchSelectionQualityEvidence } from "./selection-quality-evidence.js";

export async function createLocalSearchSelectionQualityReport(input: {
  repositoryRoot: string;
  projectId: string;
}): Promise<SearchSelectionQualityReport> {
  const evidence = await loadVerifiedSearchSelectionQualityEvidence(input);
  return evidence.report;
}
