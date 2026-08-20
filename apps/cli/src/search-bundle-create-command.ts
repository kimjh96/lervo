import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadProjectManifest } from "@lervo/project";
import {
  createSearchEvaluationBundle,
  type SearchEvaluationCaseReplacement,
} from "@lervo/search";
import {
  loadSearchEvaluationCases,
  recordSearchEvaluationBundle,
} from "@lervo/search-local";

import { searchArgumentError, searchErrorCode, searchUsage } from "./search-command-common.js";
import { formatSearchEvaluationBundle } from "./search-evaluation-format.js";
import type { CliIo } from "./types.js";

function replacements(values: string[] | undefined): SearchEvaluationCaseReplacement[] {
  return (values ?? []).map((value) => {
    const separator = value.indexOf(":");
    if (separator < 1 || separator !== value.lastIndexOf(":") || separator === value.length - 1) {
      throw new Error(`대체 관계는 <old-case-id>:<new-case-id> 형식이어야 합니다: ${value}`);
    }
    return { replacedCaseId: value.slice(0, separator), replacementCaseId: value.slice(separator + 1) };
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
  if (parsed.positionals.length !== 1 || parsed.values.role === undefined ||
    parsed.values["task-type"] === undefined || parsed.values["minimum-cases"] === undefined ||
    !Number.isSafeInteger(minimumActiveCases) || minimumActiveCases < 1 || minimumActiveCases > 64) {
    io.stderr(`bundle ID, role, task-type과 1~64의 minimum-cases가 필요합니다.\n${searchUsage}\n`);
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
    io.stdout(parsed.values.json
      ? `${JSON.stringify(bundle, null, 2)}\n`
      : formatSearchEvaluationBundle(bundle));
    return 0;
  } catch (error) {
    io.stderr(`검색 평가 묶음을 만들지 못했습니다. (${searchErrorCode(error)}) ${
      error instanceof Error ? error.message : "알 수 없는 오류입니다."
    }\n`);
    return 1;
  }
}
