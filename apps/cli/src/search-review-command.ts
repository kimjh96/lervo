import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadProjectManifest } from "@lervo/project";
import { type SearchCandidateReviewDecision } from "@lervo/search";
import {
  loadStoredSearchEvaluationComparison,
  reviewLocalSearchCandidate,
} from "@lervo/search-local";

import { searchCandidateRegistry } from "./search-candidate-registry.js";
import { searchArgumentError, searchErrorCode, searchUsage } from "./search-command-common.js";
import { formatSearchCandidateReview } from "./search-evaluation-format.js";
import type { CliIo } from "./types.js";

const DECISIONS: Record<string, SearchCandidateReviewDecision> = {
  adopt: "adopt_candidate",
  reject: "reject_candidate",
  "more-samples": "more_samples_required",
};

async function candidateRegistration(root: string, comparisonId: string) {
  const comparison = await loadStoredSearchEvaluationComparison(root, comparisonId);
  return searchCandidateRegistry.resolveEngine(comparison.candidate.engine);
}

export async function runSearchReviewCommand(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        decision: { type: "string" },
        reviewer: { type: "string" },
        json: { type: "boolean" },
      },
    });
  } catch (error) {
    io.stderr(searchArgumentError(error));
    return 1;
  }
  const decision = parsed.values.decision === undefined ? undefined : DECISIONS[parsed.values.decision];
  if (parsed.positionals.length !== 1 || decision === undefined || parsed.values.reviewer === undefined) {
    io.stderr(`comparison ID, adopt|reject|more-samples 결정과 reviewer ID가 필요합니다.\n${searchUsage}\n`);
    return 1;
  }
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  try {
    const registration = await candidateRegistration(root, parsed.positionals[0]!);
    const manifest = await loadProjectManifest(root);
    const review = await reviewLocalSearchCandidate({
      repositoryRoot: root,
      projectId: manifest.projectId,
      comparisonId: parsed.positionals[0]!,
      registration,
      reviewerId: parsed.values.reviewer,
      reviewedAt: new Date(),
      decision,
    });
    io.stdout(parsed.values.json ? `${JSON.stringify(review, null, 2)}\n` : formatSearchCandidateReview(review));
    return 0;
  } catch (error) {
    io.stderr(`검색 후보 검토를 완료하지 못했습니다. (${searchErrorCode(error)}) ${
      error instanceof Error ? error.message : "알 수 없는 오류입니다."
    }\n`);
    return 1;
  }
}
