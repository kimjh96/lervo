import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadProjectManifest } from "@lervo/project";
import { createSearchAttempt } from "@lervo/search";
import { LocalSearchObservationStore, runLocalOperationalSearch } from "@lervo/search-local";

import { searchCandidateRegistry } from "./search-candidate-registry.js";
import { searchArgumentError, searchErrorCode, searchUsage } from "./search-command-common.js";
import { formatSearchResponse } from "./search-format.js";
import type { CliIo } from "./types.js";

export async function runSearchQueryCommand(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        limit: { type: "string" },
        json: { type: "boolean" },
      },
    });
  } catch (error) {
    io.stderr(searchArgumentError(error));
    return 1;
  }
  if (parsed.positionals.length !== 1) {
    io.stderr(`검색 문장은 하나만 지정해야 합니다.\n${searchUsage}\n`);
    return 1;
  }
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  try {
    const manifest = await loadProjectManifest(root);
    const operational = await runLocalOperationalSearch({
      repositoryRoot: root,
      projectId: manifest.projectId,
      registry: searchCandidateRegistry,
      query: parsed.positionals[0]!,
      limit: parsed.values.limit === undefined ? 10 : Number(parsed.values.limit),
    });
    const response = operational.response;
    const attempt = createSearchAttempt({
      projectId: manifest.projectId,
      observedAt: new Date(),
      nonce: randomBytes(16).toString("hex"),
      response,
      selectionTransitionId: operational.selectionTransitionId,
    });
    const store = await LocalSearchObservationStore.open(root);
    await store.recordAttempt(attempt);
    io.stdout(parsed.values.json
      ? `${JSON.stringify({
        ...response,
        selectionTransitionId: operational.selectionTransitionId,
        attemptId: attempt.attemptId,
      }, null, 2)}\n`
      : formatSearchResponse(response, attempt.attemptId));
    return 0;
  } catch (error) {
    io.stderr(`검색을 완료하지 못했습니다. (${searchErrorCode(error)}) ${
      error instanceof Error ? error.message : "알 수 없는 오류입니다."
    }\n`);
    return 1;
  }
}
