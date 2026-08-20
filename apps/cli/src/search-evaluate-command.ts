import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadProjectManifest } from "@lervo/project";
import { createSearchEvaluationCoverage, type SearchEvaluationCoverage } from "@lervo/search";
import {
  loadSearchEvaluationBundles,
  loadSearchEvaluationCases,
  runLocalSearchEvaluation,
} from "@lervo/search-local";

import { searchArgumentError, searchErrorCode, searchUsage } from "./search-command-common.js";
import { formatSearchEvaluationCoverage, formatSearchEvaluationRun } from "./search-evaluation-format.js";
import type { CliIo } from "./types.js";

export async function runSearchEvaluateCommand(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        bundle: { type: "string" },
        json: { type: "boolean" },
      },
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
    let coverage: SearchEvaluationCoverage | null = null;
    if (parsed.values.bundle !== undefined) {
      const cases = await loadSearchEvaluationCases(root);
      const bundles = await loadSearchEvaluationBundles({ repositoryRoot: root, cases });
      const bundle = bundles.find((item) => item.bundleId === parsed.values.bundle);
      if (bundle === undefined) throw new Error("검색 평가 묶음을 찾을 수 없습니다.");
      coverage = createSearchEvaluationCoverage(bundle, cases);
    }
    const output = await runLocalSearchEvaluation({
      repositoryRoot: root,
      projectId: manifest.projectId,
      evaluatedAt: new Date(),
      ...(coverage === null ? {} : { caseIds: coverage.activeCaseIds }),
    });
    io.stdout(parsed.values.json
      ? `${JSON.stringify({ ...(coverage === null ? {} : { coverage }), ...output }, null, 2)}\n`
      : `${coverage === null ? "" : formatSearchEvaluationCoverage(coverage)}${formatSearchEvaluationRun(output.run)}`);
    return output.run.failedCases === 0 && coverage?.sampleState !== "insufficient" ? 0 : 1;
  } catch (error) {
    io.stderr(`검색 반복 평가를 완료하지 못했습니다. (${searchErrorCode(error)}) ${
      error instanceof Error ? error.message : "알 수 없는 오류입니다."
    }\n`);
    return 1;
  }
}
