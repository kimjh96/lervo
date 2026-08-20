import { runSearchAssessmentCommand } from "./search-assessment-command.js";
import { runSearchBundleCommand } from "./search-bundle-command.js";
import { runSearchCaseCommand } from "./search-case-command.js";
import { runSearchCandidatesCommand } from "./search-candidates-command.js";
import { runSearchCompareCommand } from "./search-compare-command.js";
import { searchUsage } from "./search-command-common.js";
import { runSearchEvaluateCommand } from "./search-evaluate-command.js";
import { runSearchQueryCommand } from "./search-query-command.js";
import { runSearchReportCommand } from "./search-report-command.js";
import { runSearchReviewCommand } from "./search-review-command.js";
import type { CliIo } from "./types.js";

export { searchUsage } from "./search-command-common.js";
export { formatSearchQualityReport } from "./search-format.js";

export async function runSearchCommand(args: string[], io: CliIo): Promise<number> {
  if (args[0] === "assess") return runSearchAssessmentCommand(args.slice(1), io);
  if (args[0] === "case") return runSearchCaseCommand(args.slice(1), io);
  if (args[0] === "candidates") return runSearchCandidatesCommand(args.slice(1), io);
  if (args[0] === "compare") return runSearchCompareCommand(args.slice(1), io);
  if (args[0] === "bundle") return runSearchBundleCommand(args.slice(1), io);
  if (args[0] === "evaluate") return runSearchEvaluateCommand(args.slice(1), io);
  if (args[0] === "report") return runSearchReportCommand(args.slice(1), io);
  if (args[0] === "review") return runSearchReviewCommand(args.slice(1), io);
  if (args[0] === "--help" || args[0] === "-h") {
    io.stdout(`${searchUsage}\n`);
    return 0;
  }
  return runSearchQueryCommand(args, io);
}
