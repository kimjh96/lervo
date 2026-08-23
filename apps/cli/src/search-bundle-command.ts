import { runSearchBundleCreateCommand } from "./search-bundle-create-command.js";
import { runSearchBundleReportCommand } from "./search-bundle-report-command.js";
import { searchUsage } from "./search-command-common.js";
import type { CliIo } from "./types.js";

export async function runSearchBundleCommand(args: string[], io: CliIo): Promise<number> {
  if (args[0] === "create") return runSearchBundleCreateCommand(args.slice(1), io);
  if (args[0] === "report") return runSearchBundleReportCommand(args.slice(1), io);
  io.stderr(`bundle requires create or report.\n${searchUsage}\n`);
  return 1;
}
