import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadProjectManifest } from "@lervo/project";
import { createSearchEngineActivationPolicy } from "@lervo/search";
import { recordSearchEngineActivationPolicy } from "@lervo/search-local";

import { searchCandidateRegistry } from "./search-candidate-registry.js";
import { searchArgumentError, searchErrorCode, searchUsage } from "./search-command-common.js";
import { formatSearchEngineActivationPolicy } from "./search-evaluation-format.js";
import type { CliIo } from "./types.js";

export async function runSearchEnginePolicyCommand(args: string[], io: CliIo): Promise<number> {
  if (args[0] !== "create") {
    io.stderr(`검색 엔진 정책 작업은 create를 명시해야 합니다.\n${searchUsage}\n`);
    return 1;
  }
  let parsed;
  try {
    parsed = parseArgs({
      args: args.slice(1),
      strict: true,
      allowPositionals: false,
      options: {
        root: { type: "string" },
        reviewer: { type: "string", multiple: true },
        operator: { type: "string", multiple: true },
        author: { type: "string" },
        candidate: { type: "string", multiple: true },
        "minimum-wins": { type: "string", default: "1" },
        json: { type: "boolean" },
      },
    });
  } catch (error) {
    io.stderr(searchArgumentError(error));
    return 1;
  }
  const reviewers = parsed.values.reviewer ?? [];
  const operators = parsed.values.operator ?? [];
  const candidates = parsed.values.candidate ?? [];
  const minimumWins = Number(parsed.values["minimum-wins"]);
  if (reviewers.length === 0 || operators.length === 0 || candidates.length === 0 ||
    parsed.values.author === undefined) {
    io.stderr(`reviewer, operator, author와 candidate를 각각 하나 이상 명시해야 합니다.\n${searchUsage}\n`);
    return 1;
  }
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  try {
    for (const candidateId of candidates) searchCandidateRegistry.resolve(candidateId);
    const manifest = await loadProjectManifest(root);
    const policy = createSearchEngineActivationPolicy({
      projectId: manifest.projectId,
      allowedReviewerIds: reviewers,
      allowedOperatorIds: operators,
      allowedCandidateIds: candidates,
      minimumCandidateWins: minimumWins,
      authoredBy: parsed.values.author,
      createdAt: new Date(),
    });
    await recordSearchEngineActivationPolicy(root, policy);
    io.stdout(parsed.values.json
      ? `${JSON.stringify(policy, null, 2)}\n`
      : formatSearchEngineActivationPolicy(policy));
    return 0;
  } catch (error) {
    io.stderr(`검색 엔진 활성화 정책을 만들지 못했습니다. (${searchErrorCode(error)}) ${
      error instanceof Error ? error.message : "알 수 없는 오류입니다."
    }\n`);
    return 1;
  }
}
