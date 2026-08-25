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
    io.stderr(`report accepts exactly one bundle ID.\n${searchUsage}\n`);
    return 1;
  }
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  try {
    const [manifest, cases] = await Promise.all([
      loadProjectManifest(root),
      loadSearchEvaluationCases(root),
    ]);
    const bundles = await loadSearchEvaluationBundles({ repositoryRoot: root, cases });
    const selected =
      parsed.positionals[0] === undefined
        ? bundles
        : bundles.filter((bundle) => bundle.bundleId === parsed.positionals[0]);
    if (selected.length === 0) throw new Error("Could not find the search evaluation bundle.");
    if (selected.some((bundle) => bundle.projectId !== manifest.projectId)) {
      throw new Error("The search evaluation bundle project coordinate does not match.");
    }
    const coverages = selected.map((bundle) => createSearchEvaluationCoverage(bundle, cases));
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify({ coverages }, null, 2)}\n`
        : coverages.map(formatSearchEvaluationCoverage).join(""),
    );
    return coverages.every((coverage) => coverage.sampleState === "sufficient") ? 0 : 1;
  } catch (error) {
    io.stderr(
      `Could not inspect the search evaluation sample. (${searchErrorCode(error)}) ${
        error instanceof Error ? error.message : "Unknown error."
      }\n`,
    );
    return 1;
  }
}
