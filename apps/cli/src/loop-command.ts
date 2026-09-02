import { executeGovernedAttempt } from "./governed-attempt-runner.js";
import { executeCompletionReconciliation } from "./governed-completion-reconciliation-command.js";
import { loopUsage, parseLoopOptions } from "./loop-options.js";
import {
  formatGovernedWorkReport,
  renderCompletionReconciliationResult,
  renderGovernedAttemptResult,
} from "./loop-renderer.js";
import type { CliIo, CliServices } from "./types.js";

export { formatGovernedWorkReport, loopUsage };

export async function runLoopCommand(
  args: string[],
  io: CliIo,
  services: CliServices,
): Promise<number> {
  try {
    const options = parseLoopOptions(args, io.cwd);
    if (options.action === "help") {
      io.stdout(`${loopUsage}\n`);
      return 0;
    }
    const report = await services.inspectGovernedWork({
      repositoryRoot: options.repositoryRoot,
      policy: options.policy,
    });
    if (options.action === "status") {
      io.stdout(
        options.json ? `${JSON.stringify(report, null, 2)}\n` : formatGovernedWorkReport(report),
      );
      return report.decision.status === "invalid" ? 1 : 0;
    }
    if (options.action === "reconcile") {
      const result = await executeCompletionReconciliation(options, report, services);
      io.stdout(renderCompletionReconciliationResult(result, options.json));
      return 0;
    }

    const result = await executeGovernedAttempt(options, report, services);
    const rendered = renderGovernedAttemptResult(result, options.json);
    io[rendered.channel](rendered.output);
    return rendered.exitCode;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${loopUsage}\n`);
    return 1;
  }
}
