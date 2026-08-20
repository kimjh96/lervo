import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadProjectManifest } from "@lervo/project";
import { runLocalSearchEvaluationComparison } from "@lervo/search-local";

import { searchCandidateRegistry } from "./search-candidate-registry.js";
import { searchArgumentError, searchErrorCode, searchUsage } from "./search-command-common.js";
import { formatSearchEvaluationComparison } from "./search-evaluation-format.js";
import type { CliIo } from "./types.js";

export async function runSearchCompareCommand(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        candidate: { type: "string" },
        json: { type: "boolean" },
      },
    });
  } catch (error) {
    io.stderr(searchArgumentError(error));
    return 1;
  }
  if (parsed.positionals.length !== 1 || parsed.values.candidate === undefined) {
    io.stderr(`bundle ID와 등록된 candidate ID가 필요합니다.\n${searchUsage}\n`);
    return 1;
  }
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  try {
    const candidateEngine = searchCandidateRegistry.resolve(parsed.values.candidate);
    const manifest = await loadProjectManifest(root);
    const output = await runLocalSearchEvaluationComparison({
      repositoryRoot: root,
      projectId: manifest.projectId,
      bundleId: parsed.positionals[0]!,
      candidateEngine,
      evaluatedAt: new Date(),
    });
    io.stdout(parsed.values.json
      ? `${JSON.stringify({
        comparison: output.comparison,
        baseline: output.baseline.run,
        candidate: output.candidate.run,
      }, null, 2)}\n`
      : formatSearchEvaluationComparison(output.comparison));
    return 0;
  } catch (error) {
    io.stderr(`검색 후보 비교를 완료하지 못했습니다. (${searchErrorCode(error)}) ${
      error instanceof Error ? error.message : "알 수 없는 오류입니다."
    }\n`);
    return 1;
  }
}
