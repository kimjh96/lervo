import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadProjectManifest } from "@lervo/project";
import { createLocalSearchSelectionQualityReport } from "@lervo/search-local";

import { searchArgumentError, searchErrorCode, searchUsage } from "./search-command-common.js";
import { formatSearchQualityReport } from "./search-format.js";
import type { CliIo } from "./types.js";

export async function runSearchReportCommand(args: string[], io: CliIo): Promise<number> {
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
    io.stderr(`report does not accept additional arguments.\n${searchUsage}\n`);
    return 1;
  }
  try {
    const root = resolve(io.cwd, parsed.values.root ?? ".");
    const manifest = await loadProjectManifest(root);
    const report = await createLocalSearchSelectionQualityReport({
      repositoryRoot: root,
      projectId: manifest.projectId,
    });
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatSearchQualityReport(report),
    );
    return 0;
  } catch (error) {
    io.stderr(
      `Could not read the search quality observation. (${searchErrorCode(error)}) ${
        error instanceof Error ? error.message : "Unknown error."
      }\n`,
    );
    return 1;
  }
}
