import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { baselineSearchEngineSelection } from "@lervo/search";
import { loadSearchEngineActivationHistory } from "@lervo/search-local";

import { searchArgumentError, searchErrorCode } from "./search-command-common.js";
import { formatSearchEngineStatus } from "./search-evaluation-format.js";
import type { CliIo } from "./types.js";

export async function runSearchEngineStatusCommand(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: { root: { type: "string" }, json: { type: "boolean" } },
    });
  } catch (error) {
    io.stderr(searchArgumentError(error));
    return 1;
  }
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  try {
    const history = await loadSearchEngineActivationHistory(root);
    const current = history.at(-1) ?? null;
    const status = {
      selection: current?.selected ?? baselineSearchEngineSelection(),
      selectionTransitionId: current?.activationId ?? null,
      transitions: history.length,
      applicationState: "not_connected" as const,
    };
    io.stdout(parsed.values.json ? `${JSON.stringify(status, null, 2)}\n` : formatSearchEngineStatus(status));
    return 0;
  } catch (error) {
    io.stderr(`검색 엔진 선택 상태를 읽지 못했습니다. (${searchErrorCode(error)}) ${
      error instanceof Error ? error.message : "알 수 없는 오류입니다."
    }\n`);
    return 1;
  }
}
