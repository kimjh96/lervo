import { runSearchBundleCreateCommand } from "./search-bundle-create-command.js";
import { runSearchBundleReportCommand } from "./search-bundle-report-command.js";
import { searchUsage } from "./search-command-common.js";
import type { CliIo } from "./types.js";

export async function runSearchBundleCommand(args: string[], io: CliIo): Promise<number> {
  if (args[0] === "create") return runSearchBundleCreateCommand(args.slice(1), io);
  if (args[0] === "report") return runSearchBundleReportCommand(args.slice(1), io);
  io.stderr(`bundle에는 create 또는 report가 필요합니다.\n${searchUsage}\n`);
  return 1;
}
