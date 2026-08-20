import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadProjectManifest } from "@lervo/project";
import { type SearchRolloutReviewDecision } from "@lervo/search";
import { reviewLocalSearchRollout } from "@lervo/search-local";

import { searchArgumentError, searchErrorCode, searchUsage } from "./search-command-common.js";
import { formatSearchRolloutReview } from "./search-rollout-format.js";
import { runSearchRolloutPolicyCommand } from "./search-rollout-policy-command.js";
import { runSearchRolloutStatusCommand } from "./search-rollout-status-command.js";
import type { CliIo } from "./types.js";

const DECISIONS: Record<string, SearchRolloutReviewDecision> = {
  keep: "keep_candidate",
  rollback: "rollback_recommended",
  "more-assessments": "more_assessments_required",
};

async function runSearchRolloutReviewCommand(args: string[], io: CliIo): Promise<number> {
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
        policy: { type: "string" },
        json: { type: "boolean" },
      },
    });
  } catch (error) {
    io.stderr(searchArgumentError(error));
    return 1;
  }
  const decision = parsed.values.decision === undefined ? undefined : DECISIONS[parsed.values.decision];
  if (parsed.positionals.length !== 1 || decision === undefined || parsed.values.reviewer === undefined) {
    io.stderr(`선택 전이 ID, keep|rollback|more-assessments 판단과 reviewer ID가 필요합니다.\n${searchUsage}\n`);
    return 1;
  }
  try {
    const root = resolve(io.cwd, parsed.values.root ?? ".");
    const manifest = await loadProjectManifest(root);
    const review = await reviewLocalSearchRollout({
      repositoryRoot: root,
      projectId: manifest.projectId,
      selectionTransitionId: parsed.positionals[0]!,
      reviewerId: parsed.values.reviewer,
      reviewedAt: new Date(),
      decision,
      ...(parsed.values.policy === undefined ? {} : { policyId: parsed.values.policy }),
    });
    io.stdout(parsed.values.json ? `${JSON.stringify(review, null, 2)}\n` : formatSearchRolloutReview(review));
    return 0;
  } catch (error) {
    io.stderr(`검색 rollout 검토를 기록하지 못했습니다. (${searchErrorCode(error)}) ${
      error instanceof Error ? error.message : "알 수 없는 오류입니다."
    }\n`);
    return 1;
  }
}

export async function runSearchRolloutCommand(args: string[], io: CliIo): Promise<number> {
  if (args[0] === "review") return runSearchRolloutReviewCommand(args.slice(1), io);
  if (args[0] === "policy") return runSearchRolloutPolicyCommand(args.slice(1), io);
  if (args[0] === "status") return runSearchRolloutStatusCommand(args.slice(1), io);
  io.stderr(`rollout 하위 명령은 policy, review와 status를 지원합니다.\n${searchUsage}\n`);
  return 1;
}
