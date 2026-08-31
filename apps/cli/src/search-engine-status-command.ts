import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadProjectManifest } from "@lervo/project";
import { inspectOperationalSearchEngine } from "@lervo/search-local";

import { searchCandidateRegistry } from "./search-candidate-registry.js";
import { searchArgumentError, searchErrorCode } from "./search-command-common.js";
import { formatSearchEngineStatus } from "./search-evaluation-format.js";
import { productDefaultSearchEngine } from "./product-default-search.js";
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
    const manifest = await loadProjectManifest(root);
    const status = await inspectOperationalSearchEngine({
      repositoryRoot: root,
      projectId: manifest.projectId,
      registry: searchCandidateRegistry,
      productDefault: productDefaultSearchEngine,
    });
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(status, null, 2)}\n`
        : formatSearchEngineStatus(status),
    );
    return status.resolverState === "ready" ? 0 : 1;
  } catch (error) {
    io.stderr(
      `Could not read search engine selection status. (${searchErrorCode(error)}) ${
        error instanceof Error ? error.message : "Unknown error."
      }\n`,
    );
    return 1;
  }
}
