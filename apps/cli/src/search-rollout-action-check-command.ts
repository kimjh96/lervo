import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadProjectManifest } from "@lervo/project";
import type { SearchRolloutActionKind } from "@lervo/search";
import { checkLocalSearchRolloutAction } from "@lervo/search-local";

import { searchCandidateRegistry } from "./search-candidate-registry.js";
import { searchArgumentError, searchErrorCode, searchUsage } from "./search-command-common.js";
import { formatSearchRolloutActionPreflight } from "./search-rollout-format.js";
import type { CliIo } from "./types.js";

const actions: Record<string, SearchRolloutActionKind> = {
  keep: "acknowledge_keep",
  rollback: "execute_rollback",
};

export async function runSearchRolloutActionCheckCommand(
  args: string[],
  io: CliIo,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        action: { type: "string" },
        policy: { type: "string" },
        operator: { type: "string" },
        json: { type: "boolean" },
      },
    });
  } catch (error) {
    io.stderr(searchArgumentError(error));
    return 1;
  }
  const action = parsed.values.action === undefined ? undefined : actions[parsed.values.action];
  if (
    parsed.positionals.length !== 1 ||
    action === undefined ||
    parsed.values.policy === undefined ||
    parsed.values.operator === undefined
  ) {
    io.stderr(
      `A rollout review ID, keep|rollback action, action policy, and operator are required.\n${searchUsage}\n`,
    );
    return 1;
  }
  try {
    const root = resolve(io.cwd, parsed.values.root ?? ".");
    const manifest = await loadProjectManifest(root);
    const result = await checkLocalSearchRolloutAction({
      repositoryRoot: root,
      projectId: manifest.projectId,
      rolloutReviewId: parsed.positionals[0]!,
      actionPolicyId: parsed.values.policy,
      requestedAction: action,
      operatorId: parsed.values.operator,
      checkedAt: new Date(),
      registry: searchCandidateRegistry,
    });
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : formatSearchRolloutActionPreflight(result),
    );
    return 0;
  } catch (error) {
    io.stderr(
      `Could not check the search rollout action. (${searchErrorCode(error)}) ${
        error instanceof Error ? error.message : "Unknown error."
      }\n`,
    );
    return 1;
  }
}
