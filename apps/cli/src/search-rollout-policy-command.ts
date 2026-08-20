import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadProjectManifest } from "@lervo/project";
import { createSearchRolloutReviewPolicy } from "@lervo/search";
import {
  assessLocalSearchRolloutReviewPolicy,
  recordSearchRolloutReviewPolicy,
} from "@lervo/search-local";

import { searchCandidateRegistry } from "./search-candidate-registry.js";
import { searchArgumentError, searchErrorCode, searchUsage } from "./search-command-common.js";
import {
  formatSearchRolloutPolicy,
  formatSearchRolloutPolicyAssessment,
} from "./search-rollout-format.js";
import type { CliIo } from "./types.js";

function count(value: string, name: string, minimum: number): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${name}은 ${minimum} 이상 10000 이하의 정수여야 합니다.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > 10_000) {
    throw new Error(`${name}은 ${minimum} 이상 10000 이하의 정수여야 합니다.`);
  }
  return parsed;
}

async function runCreate(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        root: { type: "string" },
        reviewer: { type: "string", multiple: true },
        author: { type: "string" },
        candidate: { type: "string", multiple: true },
        "keep-min-assessments": { type: "string", default: "1" },
        "keep-max-failures": { type: "string", default: "0" },
        "rollback-min-assessments": { type: "string", default: "1" },
        "rollback-min-failures": { type: "string", default: "1" },
        json: { type: "boolean" },
      },
    });
  } catch (error) {
    io.stderr(searchArgumentError(error));
    return 1;
  }
  const reviewers = parsed.values.reviewer ?? [];
  const candidates = parsed.values.candidate ?? [];
  if (reviewers.length === 0 || candidates.length === 0 || parsed.values.author === undefined) {
    io.stderr(`reviewer, author와 candidate를 각각 하나 이상 명시해야 합니다.\n${searchUsage}\n`);
    return 1;
  }
  try {
    for (const candidateId of candidates) searchCandidateRegistry.resolve(candidateId);
    const root = resolve(io.cwd, parsed.values.root ?? ".");
    const manifest = await loadProjectManifest(root);
    const policy = createSearchRolloutReviewPolicy({
      projectId: manifest.projectId,
      allowedReviewerIds: reviewers,
      allowedCandidateIds: candidates,
      keepMinimumAssessedAttempts: count(
        parsed.values["keep-min-assessments"],
        "keep-min-assessments",
        1,
      ),
      keepMaximumFailedAttempts: count(parsed.values["keep-max-failures"], "keep-max-failures", 0),
      rollbackMinimumAssessedAttempts: count(
        parsed.values["rollback-min-assessments"],
        "rollback-min-assessments",
        1,
      ),
      rollbackMinimumFailedAttempts: count(
        parsed.values["rollback-min-failures"],
        "rollback-min-failures",
        1,
      ),
      authoredBy: parsed.values.author,
      createdAt: new Date(),
    });
    await recordSearchRolloutReviewPolicy(root, policy);
    io.stdout(parsed.values.json ? `${JSON.stringify(policy, null, 2)}\n` : formatSearchRolloutPolicy(policy));
    return 0;
  } catch (error) {
    io.stderr(`검색 rollout 검토 정책을 만들지 못했습니다. (${searchErrorCode(error)}) ${
      error instanceof Error ? error.message : "알 수 없는 오류입니다."
    }\n`);
    return 1;
  }
}

async function runCheck(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        policy: { type: "string" },
        json: { type: "boolean" },
      },
    });
  } catch (error) {
    io.stderr(searchArgumentError(error));
    return 1;
  }
  if (parsed.positionals.length !== 1 || parsed.values.policy === undefined) {
    io.stderr(`rollout 검토 ID와 policy ID가 필요합니다.\n${searchUsage}\n`);
    return 1;
  }
  try {
    const root = resolve(io.cwd, parsed.values.root ?? ".");
    const manifest = await loadProjectManifest(root);
    const assessment = await assessLocalSearchRolloutReviewPolicy({
      repositoryRoot: root,
      projectId: manifest.projectId,
      policyId: parsed.values.policy,
      rolloutReviewId: parsed.positionals[0]!,
    });
    io.stdout(parsed.values.json
      ? `${JSON.stringify(assessment, null, 2)}\n`
      : formatSearchRolloutPolicyAssessment(assessment));
    return 0;
  } catch (error) {
    io.stderr(`검색 rollout 검토의 정책 충족 여부를 확인하지 못했습니다. (${searchErrorCode(error)}) ${
      error instanceof Error ? error.message : "알 수 없는 오류입니다."
    }\n`);
    return 1;
  }
}

export async function runSearchRolloutPolicyCommand(args: string[], io: CliIo): Promise<number> {
  if (args[0] === "create") return runCreate(args.slice(1), io);
  if (args[0] === "check") return runCheck(args.slice(1), io);
  io.stderr(`검색 rollout 검토 정책 작업은 create 또는 check를 명시해야 합니다.\n${searchUsage}\n`);
  return 1;
}
