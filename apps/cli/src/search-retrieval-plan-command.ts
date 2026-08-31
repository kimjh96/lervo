import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadProjectManifest } from "@lervo/project";
import {
  activateLocalSearchRetrievalPlan,
  inspectOperationalSearchRetrievalPlan,
  rollbackLocalSearchRetrievalPlan,
} from "@lervo/search-local";

import { searchArgumentError, searchErrorCode, searchUsage } from "./search-command-common.js";
import type { CliIo } from "./types.js";

function parseActionArguments(args: string[]) {
  return parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      root: { type: "string" },
      operator: { type: "string" },
      json: { type: "boolean" },
    },
  });
}

export async function runSearchRetrievalPlanCommand(args: string[], io: CliIo): Promise<number> {
  const action = args[0];
  if (!new Set(["activate", "rollback", "status"]).has(action ?? "")) {
    io.stderr(`The search plan action must be activate, rollback, or status.\n${searchUsage}\n`);
    return 1;
  }
  let parsed;
  try {
    parsed = parseActionArguments(args.slice(1));
  } catch (error) {
    io.stderr(searchArgumentError(error));
    return 1;
  }
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  try {
    const manifest = await loadProjectManifest(root);
    if (action === "status") {
      if (parsed.positionals.length !== 0 || parsed.values.operator !== undefined) {
        throw new Error("search plan status accepts no bundle or operator.");
      }
      const status = await inspectOperationalSearchRetrievalPlan({
        repositoryRoot: root,
        projectId: manifest.projectId,
      });
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(status, null, 2)}\n`
          : [
              `Search retrieval plan: ${status.selection.mode}`,
              `plan: ${status.selection.planId ?? "baseline"}`,
              `transition: ${status.selectionTransitionId ?? "none"}`,
              `resolver: ${status.resolverState}`,
            ].join("\n") + "\n",
      );
      return status.resolverState === "ready" ? 0 : 1;
    }
    if (parsed.values.operator === undefined) {
      throw new Error("search plan activation and rollback require --operator.");
    }
    const activation =
      action === "activate"
        ? await (async () => {
            if (parsed.positionals.length !== 1)
              throw new Error("search plan activate requires exactly one bundle ID.");
            return activateLocalSearchRetrievalPlan({
              repositoryRoot: root,
              projectId: manifest.projectId,
              bundleId: parsed.positionals[0]!,
              operatorId: parsed.values.operator!,
              decidedAt: new Date(),
            });
          })()
        : await (async () => {
            if (parsed.positionals.length !== 0)
              throw new Error("search plan rollback accepts no bundle ID.");
            return rollbackLocalSearchRetrievalPlan({
              repositoryRoot: root,
              projectId: manifest.projectId,
              operatorId: parsed.values.operator!,
              decidedAt: new Date(),
            });
          })();
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(activation, null, 2)}\n`
        : `Search retrieval-plan transition recorded.\ntransition: ${activation.activationId}\nselection: ${activation.selected.planId ?? "baseline"}\n`,
    );
    return 0;
  } catch (error) {
    io.stderr(
      `Could not ${action} the search retrieval plan. (${searchErrorCode(error)}) ${
        error instanceof Error ? error.message : "Unknown error."
      }\n`,
    );
    return 1;
  }
}
