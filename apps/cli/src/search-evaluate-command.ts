import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadProjectManifest } from "@lervo/project";
import { runLocalSearchEvaluation } from "@lervo/search-local";

import { searchArgumentError, searchErrorCode, searchUsage } from "./search-command-common.js";
import { formatSearchEvaluationRun } from "./search-evaluation-format.js";
import type { CliIo } from "./types.js";

export async function runSearchEvaluateCommand(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: { root: { type: "string" }, json: { type: "boolean" } },
    });
  } catch (error) {
    io.stderr(searchArgumentError(error));
    return 1;
  }
  if (parsed.positionals.length !== 0) {
    io.stderr(`evaluate에는 다른 인자를 지정할 수 없습니다.\n${searchUsage}\n`);
    return 1;
  }
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  try {
    const manifest = await loadProjectManifest(root);
    const output = await runLocalSearchEvaluation({
      repositoryRoot: root,
      projectId: manifest.projectId,
      evaluatedAt: new Date(),
    });
    io.stdout(parsed.values.json
      ? `${JSON.stringify(output, null, 2)}\n`
      : formatSearchEvaluationRun(output.run));
    return output.run.failedCases === 0 ? 0 : 1;
  } catch (error) {
    io.stderr(`검색 반복 평가를 완료하지 못했습니다. (${searchErrorCode(error)}) ${
      error instanceof Error ? error.message : "알 수 없는 오류입니다."
    }\n`);
    return 1;
  }
}
