import { searchUsage } from "./search-command-common.js";
import { runSearchEngineActivateCommand } from "./search-engine-activate-command.js";
import { runSearchEnginePolicyCommand } from "./search-engine-policy-command.js";
import { runSearchEngineRefreshCommand } from "./search-engine-refresh-command.js";
import { runSearchEngineRollbackCommand } from "./search-engine-rollback-command.js";
import { runSearchEngineStatusCommand } from "./search-engine-status-command.js";
import type { CliIo } from "./types.js";

export async function runSearchEngineCommand(args: string[], io: CliIo): Promise<number> {
  if (args[0] === "policy") return runSearchEnginePolicyCommand(args.slice(1), io);
  if (args[0] === "activate") return runSearchEngineActivateCommand(args.slice(1), io);
  if (args[0] === "refresh") return runSearchEngineRefreshCommand(args.slice(1), io);
  if (args[0] === "rollback") return runSearchEngineRollbackCommand(args.slice(1), io);
  if (args[0] === "status") return runSearchEngineStatusCommand(args.slice(1), io);
  io.stderr(`검색 엔진 작업은 policy, activate, refresh, rollback, status 중 하나여야 합니다.\n${searchUsage}\n`);
  return 1;
}
