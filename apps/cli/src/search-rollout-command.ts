import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadProjectManifest } from "@lervo/project";
import {
  type SearchRolloutReview,
  type SearchRolloutReviewDecision,
} from "@lervo/search";
import { reviewLocalSearchRollout } from "@lervo/search-local";

import { searchArgumentError, searchErrorCode, searchUsage } from "./search-command-common.js";
import type { CliIo } from "./types.js";

const DECISIONS: Record<string, SearchRolloutReviewDecision> = {
  keep: "keep_candidate",
  rollback: "rollback_recommended",
  "more-assessments": "more_assessments_required",
};

function decisionLabel(decision: SearchRolloutReviewDecision): string {
  if (decision === "keep_candidate") return "후보 유지";
  if (decision === "rollback_recommended") return "롤백 권고";
  return "추가 평가 필요";
}

function formatSearchRolloutReview(review: SearchRolloutReview): string {
  const lines = [
    `검색 rollout 검토를 기록했습니다: ${review.rolloutReviewId}`,
    `  판단: ${decisionLabel(review.decision)}`,
    `  근거: 시도 ${review.qualitySnapshot.totalAttempts} · 평가 ${review.qualitySnapshot.assessedAttempts}` +
      ` · 실패 ${review.qualitySnapshot.failedAttempts}`,
    "  이 기록은 승인이나 검색 엔진 변경을 실행하지 않습니다.",
  ];
  return `${lines.join("\n")}\n`;
}

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
  io.stderr(`rollout 하위 명령은 review만 지원합니다.\n${searchUsage}\n`);
  return 1;
}
