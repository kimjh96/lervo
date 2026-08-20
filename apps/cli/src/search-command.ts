import { runSearchAssessmentCommand } from "./search-assessment-command.js";
import { searchUsage } from "./search-command-common.js";
import { runSearchQueryCommand } from "./search-query-command.js";
import { runSearchReportCommand } from "./search-report-command.js";
import type { CliIo } from "./types.js";

export { searchUsage } from "./search-command-common.js";
export { formatSearchQualityReport } from "./search-format.js";

export async function runSearchCommand(args: string[], io: CliIo): Promise<number> {
  if (args[0] === "assess") return runSearchAssessmentCommand(args.slice(1), io);
  if (args[0] === "report") return runSearchReportCommand(args.slice(1), io);
  if (args[0] === "--help" || args[0] === "-h") {
    io.stdout(`${searchUsage}\n`);
    return 0;
  }
  return runSearchQueryCommand(args, io);
}
