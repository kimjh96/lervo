import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadProjectManifest } from "@lervo/project";
import { createSearchEvaluationCoverage } from "@lervo/search";
import { loadSearchEvaluationBundles, loadSearchEvaluationCases } from "@lervo/search-local";

import { searchArgumentError, searchErrorCode, searchUsage } from "./search-command-common.js";
import { formatSearchEvaluationCoverage } from "./search-evaluation-format.js";
import type { CliIo } from "./types.js";

export async function runSearchBundleReportCommand(args: string[], io: CliIo): Promise<number> {
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
  if (parsed.positionals.length > 1) {
    io.stderr(`report에는 bundle ID를 하나만 지정할 수 있습니다.\n${searchUsage}\n`);
    return 1;
  }
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  try {
    const [manifest, cases] = await Promise.all([loadProjectManifest(root), loadSearchEvaluationCases(root)]);
    const bundles = await loadSearchEvaluationBundles({ repositoryRoot: root, cases });
    const selected = parsed.positionals[0] === undefined
      ? bundles
      : bundles.filter((bundle) => bundle.bundleId === parsed.positionals[0]);
    if (selected.length === 0) throw new Error("검색 평가 묶음을 찾을 수 없습니다.");
    if (selected.some((bundle) => bundle.projectId !== manifest.projectId)) {
      throw new Error("검색 평가 묶음의 project 좌표가 다릅니다.");
    }
    const coverages = selected.map((bundle) => createSearchEvaluationCoverage(bundle, cases));
    io.stdout(parsed.values.json
      ? `${JSON.stringify({ coverages }, null, 2)}\n`
      : coverages.map(formatSearchEvaluationCoverage).join(""));
    return coverages.every((coverage) => coverage.sampleState === "sufficient") ? 0 : 1;
  } catch (error) {
    io.stderr(`검색 평가 표본을 확인하지 못했습니다. (${searchErrorCode(error)}) ${
      error instanceof Error ? error.message : "알 수 없는 오류입니다."
    }\n`);
    return 1;
  }
}
