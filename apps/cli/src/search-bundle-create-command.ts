import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadProjectManifest } from "@lervo/project";
import { createSearchEvaluationBundle, type SearchEvaluationCaseReplacement } from "@lervo/search";
import { loadSearchEvaluationCases, recordSearchEvaluationBundle } from "@lervo/search-local";

import { searchArgumentError, searchErrorCode, searchUsage } from "./search-command-common.js";
import { formatSearchEvaluationBundle } from "./search-evaluation-format.js";
import type { CliIo } from "./types.js";

function replacements(values: string[] | undefined): SearchEvaluationCaseReplacement[] {
  return (values ?? []).map((value) => {
    const separator = value.indexOf(":");
    if (separator < 1 || separator !== value.lastIndexOf(":") || separator === value.length - 1) {
      throw new Error(`Replacement relationships must use <old-case-id>:<new-case-id>: ${value}`);
    }
    return {
      replacedCaseId: value.slice(0, separator),
      replacementCaseId: value.slice(separator + 1),
    };
  });
}

export async function runSearchBundleCreateCommand(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        role: { type: "string" },
        "task-type": { type: "string" },
        "minimum-cases": { type: "string" },
        case: { type: "string", multiple: true },
        replace: { type: "string", multiple: true },
        json: { type: "boolean" },
      },
    });
  } catch (error) {
    io.stderr(searchArgumentError(error));
    return 1;
  }
  const minimumActiveCases = Number(parsed.values["minimum-cases"]);
  if (
    parsed.positionals.length !== 1 ||
    parsed.values.role === undefined ||
    parsed.values["task-type"] === undefined ||
    parsed.values["minimum-cases"] === undefined ||
    !Number.isSafeInteger(minimumActiveCases) ||
    minimumActiveCases < 1 ||
    minimumActiveCases > 64
  ) {
    io.stderr(
      `A bundle ID, role, task-type, and minimum-cases from 1 to 64 are required.\n${searchUsage}\n`,
    );
    return 1;
  }
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  try {
    const [manifest, cases] = await Promise.all([
      loadProjectManifest(root),
      loadSearchEvaluationCases(root),
    ]);
    const bundle = createSearchEvaluationBundle({
      bundleId: parsed.positionals[0]!,
      projectId: manifest.projectId,
      roleId: parsed.values.role,
      taskType: parsed.values["task-type"],
      minimumActiveCases,
      activeCaseIds: parsed.values.case ?? [],
      replacements: replacements(parsed.values.replace),
    });
    await recordSearchEvaluationBundle(root, bundle, cases);
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(bundle, null, 2)}\n`
        : formatSearchEvaluationBundle(bundle),
    );
    return 0;
  } catch (error) {
    io.stderr(
      `Could not create the search evaluation bundle. (${searchErrorCode(error)}) ${
        error instanceof Error ? error.message : "Unknown error."
      }\n`,
    );
    return 1;
  }
}
