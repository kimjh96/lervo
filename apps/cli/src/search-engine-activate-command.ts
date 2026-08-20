import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadProjectManifest } from "@lervo/project";
import { activateLocalSearchCandidate } from "@lervo/search-local";

import { searchCandidateRegistry } from "./search-candidate-registry.js";
import { searchArgumentError, searchErrorCode, searchUsage } from "./search-command-common.js";
import { formatSearchEngineActivation } from "./search-evaluation-format.js";
import type { CliIo } from "./types.js";

export async function runSearchEngineActivateCommand(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        policy: { type: "string" },
        operator: { type: "string" },
        json: { type: "boolean" },
      },
    });
  } catch (error) {
    io.stderr(searchArgumentError(error));
    return 1;
  }
  if (parsed.positionals.length !== 1 || parsed.values.policy === undefined ||
    parsed.values.operator === undefined) {
    io.stderr(`review ID, policy ID와 operator ID가 필요합니다.\n${searchUsage}\n`);
    return 1;
  }
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  try {
    const manifest = await loadProjectManifest(root);
    const activation = await activateLocalSearchCandidate({
      repositoryRoot: root,
      projectId: manifest.projectId,
      reviewId: parsed.positionals[0]!,
      policyId: parsed.values.policy,
      operatorId: parsed.values.operator,
      decidedAt: new Date(),
      registry: searchCandidateRegistry,
    });
    io.stdout(parsed.values.json
      ? `${JSON.stringify(activation, null, 2)}\n`
      : formatSearchEngineActivation(activation));
    return 0;
  } catch (error) {
    io.stderr(`검색 엔진 선택을 기록하지 못했습니다. (${searchErrorCode(error)}) ${
      error instanceof Error ? error.message : "알 수 없는 오류입니다."
    }\n`);
    return 1;
  }
}
