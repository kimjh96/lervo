import { runInitCommand, initUsage } from "./init-command.js";
import { executeManagedRun } from "./managed-run.js";
import { runManagedCommand, runUsage } from "./run-command.js";
import type { CliIo, CliServices } from "./types.js";

const usage = `사용법:
${initUsage}
${runUsage}
`;

const defaultServices: CliServices = { executeManagedRun };

export async function runCli(
  args: string[],
  io: CliIo,
  services: CliServices = defaultServices,
): Promise<number> {
  const command = args[0];
  if (command === "--help" || command === "-h" || command === undefined) {
    io.stdout(usage);
    return command === undefined ? 1 : 0;
  }
  if (command === "init") return runInitCommand(args.slice(1), io);
  if (command === "run") return runManagedCommand(args.slice(1), io, services);
  io.stderr(`알 수 없는 명령입니다: ${command}\n${usage}`);
  return 1;
}

export { formatInitPlan } from "./init-command.js";
export { createManagedRunExecutor, executeManagedRun } from "./managed-run.js";
export { formatRunOutcome } from "./run-command.js";
export type { CliIo, CliServices } from "./types.js";
