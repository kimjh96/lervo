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
  const decision =
    parsed.values.decision === undefined ? undefined : DECISIONS[parsed.values.decision];
  if (
    parsed.positionals.length !== 1 ||
    decision === undefined ||
    parsed.values.reviewer === undefined
  ) {
    io.stderr(
      `A comparison ID, adopt|reject|more-samples decision, and reviewer ID are required.\n${searchUsage}\n`,
    );
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
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(review, null, 2)}\n`
        : formatSearchCandidateReview(review),
    );
    return 0;
  } catch (error) {
    io.stderr(
      `Could not complete the search candidate review. (${searchErrorCode(error)}) ${
        error instanceof Error ? error.message : "Unknown error."
      }\n`,
    );
    return 1;
  }
}
