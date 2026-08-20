import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadProjectManifest } from "@lervo/project";
import { readLocalSearchRolloutStatus } from "@lervo/search-local";

import { searchArgumentError, searchErrorCode, searchPageLimit } from "./search-command-common.js";
import { formatSearchRolloutStatus } from "./search-rollout-format.js";
import type { CliIo } from "./types.js";

export async function runSearchRolloutStatusCommand(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        root: { type: "string" },
        limit: { type: "string" },
        cursor: { type: "string" },
        json: { type: "boolean" },
      },
    });
  } catch (error) {
    io.stderr(searchArgumentError(error));
    return 1;
  }
  let limit: number | undefined;
  try {
    limit = searchPageLimit(parsed.values.limit);
  } catch (error) {
    io.stderr(searchArgumentError(error));
    return 1;
  }
  try {
    const root = resolve(io.cwd, parsed.values.root ?? ".");
    const manifest = await loadProjectManifest(root);
    const status = await readLocalSearchRolloutStatus({
      repositoryRoot: root,
      projectId: manifest.projectId,
      observedAt: new Date(),
      ...(limit === undefined ? {} : { limit }),
      ...(parsed.values.cursor === undefined ? {} : { cursor: parsed.values.cursor }),
    });
    io.stdout(parsed.values.json ? `${JSON.stringify(status, null, 2)}\n` : formatSearchRolloutStatus(status));
    return 0;
  } catch (error) {
    io.stderr(`검색 rollout 검토 상태를 읽지 못했습니다. (${searchErrorCode(error)}) ${
      error instanceof Error ? error.message : "알 수 없는 오류입니다."
    }\n`);
    return 1;
  }
}
