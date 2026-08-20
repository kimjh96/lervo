import { openProjectStorage } from "@lervo/project-storage";

import { doctorUsage, runDoctorCommand } from "./doctor-command.js";
import { inspectDoctorEnvironment } from "./doctor-environment.js";
import { runInitCommand, initUsage } from "./init-command.js";
import { executeManagedRun } from "./managed-run.js";
import { runManagedCommand, runUsage } from "./run-command.js";
import { runSearchCommand, searchUsage } from "./search-command.js";
import { runTraceCommand, traceUsage } from "./trace-command.js";
import type { CliIo, CliServiceOverrides, CliServices } from "./types.js";

const usage = `사용법:
${initUsage}
${runUsage}
${traceUsage}
${searchUsage}
${doctorUsage}
`;

const defaultServices: CliServices = {
  executeManagedRun,
  openProjectStorage,
  inspectDoctorEnvironment,
};

export async function runCli(
  args: string[],
  io: CliIo,
  serviceOverrides: CliServiceOverrides = {},
): Promise<number> {
  const services = { ...defaultServices, ...serviceOverrides };
  const command = args[0];
  if (command === "--help" || command === "-h" || command === undefined) {
    io.stdout(usage);
    return command === undefined ? 1 : 0;
  }
  if (command === "init") return runInitCommand(args.slice(1), io);
  if (command === "run") return runManagedCommand(args.slice(1), io, services);
  if (command === "trace") return runTraceCommand(args.slice(1), io, services);
  if (command === "search") return runSearchCommand(args.slice(1), io);
  if (command === "doctor") return runDoctorCommand(args.slice(1), io, services);
  io.stderr(`알 수 없는 명령입니다: ${command}\n${usage}`);
  return 1;
}

export { formatInitPlan } from "./init-command.js";
export { createManagedRunExecutor, executeManagedRun } from "./managed-run.js";
export { formatRunOutcome } from "./run-command.js";
export { formatTracePageReport, formatTraceReport } from "./trace-command.js";
export { formatSearchQualityReport } from "./search-command.js";
export { formatDoctorReport } from "./doctor-command.js";
export type { CliIo, CliServiceOverrides, CliServices } from "./types.js";
