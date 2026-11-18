import { searchUsage } from "./search-command-common.js";
import { runSearchQueryCommand } from "./search-query-command.js";
import { runSearchRetrievalPlanCommand } from "./search-retrieval-plan-command.js";
import type { CliIo } from "./types.js";

export { searchUsage } from "./search-command-common.js";

export async function runSearchCommand(args: string[], io: CliIo): Promise<number> {
  if (args[0] === "plan") return runSearchRetrievalPlanCommand(args.slice(1), io);
  if (args[0] === "--help" || args[0] === "-h") {
    io.stdout(`${searchUsage}\n`);
    return 0;
  }
  return runSearchQueryCommand(args, io);
}
