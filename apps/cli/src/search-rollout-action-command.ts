import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadProjectManifest } from "@lervo/project";
import {
  createSearchRolloutActionPolicy,
  type SearchRolloutActionKind,
} from "@lervo/search";
import {
  applyLocalSearchRolloutAction,
  loadSearchEngineActivationPolicy,
  loadSearchRolloutReviewPolicy,
  recordSearchRolloutActionPolicy,
} from "@lervo/search-local";

import { searchCandidateRegistry } from "./search-candidate-registry.js";
import { searchArgumentError, searchErrorCode, searchUsage } from "./search-command-common.js";
import {
  formatSearchRolloutActionPolicy,
  formatSearchRolloutActionResult,
} from "./search-rollout-format.js";
import type { CliIo } from "./types.js";

const actions: Record<string, SearchRolloutActionKind> = {
  keep: "acknowledge_keep",
  rollback: "execute_rollback",
};

async function runPolicyCreate(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        root: { type: "string" },
        "review-policy": { type: "string" },
        "engine-policy": { type: "string" },
        action: { type: "string" },
        operator: { type: "string", multiple: true },
        author: { type: "string" },
        json: { type: "boolean" },
      },
    });
  } catch (error) {
    io.stderr(searchArgumentError(error));
    return 1;
  }
  const action = parsed.values.action === undefined ? undefined : actions[parsed.values.action];
  const operators = parsed.values.operator ?? [];
  if (parsed.values["review-policy"] === undefined || action === undefined || operators.length === 0 ||
    parsed.values.author === undefined ||
    (action === "execute_rollback") !== (parsed.values["engine-policy"] !== undefined)) {
    io.stderr(`review-policy, keep|rollback 조치, operator와 author가 필요하며 rollback에는 engine-policy가 필요합니다.\n${searchUsage}\n`);
    return 1;
  }
  try {
    const root = resolve(io.cwd, parsed.values.root ?? ".");
    const manifest = await loadProjectManifest(root);
    const [rolloutPolicy, enginePolicy] = await Promise.all([
      loadSearchRolloutReviewPolicy(root, parsed.values["review-policy"]),
      parsed.values["engine-policy"] === undefined
        ? Promise.resolve(undefined)
        : loadSearchEngineActivationPolicy(root, parsed.values["engine-policy"]),
    ]);
    if (rolloutPolicy.projectId !== manifest.projectId ||
      (enginePolicy !== undefined && enginePolicy.projectId !== manifest.projectId)) {
      throw new Error("조치 정책 원본의 project 좌표가 현재 프로젝트와 다릅니다.");
    }
    const policy = createSearchRolloutActionPolicy({
      rolloutPolicy,
      ...(enginePolicy === undefined ? {} : { engineActivationPolicy: enginePolicy }),
      action,
      allowedOperatorIds: operators,
      authoredBy: parsed.values.author,
      createdAt: new Date(),
    });
    await recordSearchRolloutActionPolicy(root, policy);
    io.stdout(parsed.values.json
      ? `${JSON.stringify(policy, null, 2)}\n`
      : formatSearchRolloutActionPolicy(policy));
    return 0;
  } catch (error) {
    io.stderr(`검색 rollout 조치 정책을 만들지 못했습니다. (${searchErrorCode(error)}) ${
      error instanceof Error ? error.message : "알 수 없는 오류입니다."
    }\n`);
    return 1;
  }
}

async function runApply(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        action: { type: "string" },
        policy: { type: "string" },
        operator: { type: "string" },
        json: { type: "boolean" },
      },
    });
  } catch (error) {
    io.stderr(searchArgumentError(error));
    return 1;
  }
  const action = parsed.values.action === undefined ? undefined : actions[parsed.values.action];
  if (parsed.positionals.length !== 1 || action === undefined || parsed.values.policy === undefined ||
    parsed.values.operator === undefined) {
    io.stderr(`rollout 검토 ID, keep|rollback 조치, action policy와 operator가 필요합니다.\n${searchUsage}\n`);
    return 1;
  }
  try {
    const root = resolve(io.cwd, parsed.values.root ?? ".");
    const manifest = await loadProjectManifest(root);
    const result = await applyLocalSearchRolloutAction({
      repositoryRoot: root,
      projectId: manifest.projectId,
      rolloutReviewId: parsed.positionals[0]!,
      actionPolicyId: parsed.values.policy,
      requestedAction: action,
      operatorId: parsed.values.operator,
      actedAt: new Date(),
      registry: searchCandidateRegistry,
    });
    io.stdout(parsed.values.json ? `${JSON.stringify(result, null, 2)}\n` : formatSearchRolloutActionResult(result));
    return 0;
  } catch (error) {
    io.stderr(`검색 rollout 조치를 적용하지 못했습니다. (${searchErrorCode(error)}) ${
      error instanceof Error ? error.message : "알 수 없는 오류입니다."
    }\n`);
    return 1;
  }
}

export async function runSearchRolloutActionCommand(args: string[], io: CliIo): Promise<number> {
  if (args[0] === "policy" && args[1] === "create") return runPolicyCreate(args.slice(2), io);
  if (args[0] === "apply") return runApply(args.slice(1), io);
  io.stderr(`검색 rollout 조치는 policy create 또는 apply를 명시해야 합니다.\n${searchUsage}\n`);
  return 1;
}
