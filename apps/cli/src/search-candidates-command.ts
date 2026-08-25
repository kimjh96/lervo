import { parseArgs } from "node:util";

import { searchArgumentError, searchUsage } from "./search-command-common.js";
import { searchCandidateRegistry } from "./search-candidate-registry.js";
import type { CliIo } from "./types.js";

export async function runSearchCandidatesCommand(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: { json: { type: "boolean" } },
    });
  } catch (error) {
    io.stderr(searchArgumentError(error));
    return 1;
  }
  if (parsed.positionals.length !== 0) {
    io.stderr(`candidates does not accept additional arguments.\n${searchUsage}\n`);
    return 1;
  }
  const candidates = searchCandidateRegistry.list();
  io.stdout(
    parsed.values.json
      ? `${JSON.stringify({ candidates }, null, 2)}\n`
      : [
          "Registered search candidates:",
          ...candidates.map(
            (item) =>
              `  ${item.candidateId} · ${item.engine.id}-v${item.engine.version} · build ${item.adapterBuildId}`,
          ),
        ].join("\n") + "\n",
  );
  return 0;
}
