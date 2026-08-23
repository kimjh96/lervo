import { openProjectStorage } from "@lervo/project-storage";

import { doctorUsage, runDoctorCommand } from "./doctor-command.js";
import { deliberateUsage, runDeliberateCommand } from "./deliberate-command.js";
import { inspectDoctorEnvironment } from "./doctor-environment.js";
import { runInitCommand, initUsage } from "./init-command.js";
import { executeManagedRun } from "./managed-run.js";
import { executeManagedDeliberation } from "./managed-deliberation.js";
import { environmentUsage, runEnvironmentCommand } from "./environment-command.js";
import { executeEnvironmentQuery } from "./environment-services.js";
import { migrateUsage, runMigrateCommand } from "./migrate-command.js";
import { knowledgeUsage, runKnowledgeCommand } from "./knowledge-command.js";
import { repositoryUsage, runRepositoryCommand } from "./repository-command.js";
import { runManagedCommand, runUsage } from "./run-command.js";
import { runSearchCommand, searchUsage } from "./search-command.js";
import { runTraceCommand, traceUsage } from "./trace-command.js";
import type { CliIo, CliServiceOverrides, CliServices } from "./types.js";
import { runVersionCommand, versionUsage } from "./version-command.js";

const usage = `Usage:
${versionUsage}
${initUsage}
${migrateUsage}
${knowledgeUsage}
${runUsage}
${deliberateUsage}
${traceUsage}
${searchUsage}
${doctorUsage}
${environmentUsage}
${repositoryUsage}
`;

const defaultServices: CliServices = {
  executeManagedRun,
  executeManagedDeliberation,
  openProjectStorage,
  inspectDoctorEnvironment,
  executeEnvironmentQuery,
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
  if (command === "--version" || command === "-v") {
    return runVersionCommand(args.slice(1), io);
  }
  if (command === "init") return runInitCommand(args.slice(1), io);
  if (command === "migrate") return runMigrateCommand(args.slice(1), io);
  if (command === "knowledge") return runKnowledgeCommand(args.slice(1), io);
  if (command === "run") return runManagedCommand(args.slice(1), io, services);
  if (command === "deliberate") return runDeliberateCommand(args.slice(1), io, services);
  if (command === "trace") return runTraceCommand(args.slice(1), io, services);
  if (command === "search") return runSearchCommand(args.slice(1), io);
  if (command === "doctor") return runDoctorCommand(args.slice(1), io, services);
  if (command === "environment") return runEnvironmentCommand(args.slice(1), io, services);
  if (command === "repository") return runRepositoryCommand(args.slice(1), io);
  io.stderr(`Unknown command: ${command}\n${usage}`);
  return 1;
}

export { formatInitPlan } from "./init-command.js";
export { formatIdentityMigrationPlan } from "./migrate-command.js";
export { formatKnowledgeMigrationPlan } from "./knowledge-command.js";
export { createManagedRunExecutor, executeManagedRun } from "./managed-run.js";
export {
  createManagedDeliberationExecutor,
  executeManagedDeliberation,
} from "./managed-deliberation.js";
export { formatDeliberationOutcome } from "./deliberate-command.js";
export { formatRunOutcome } from "./run-command.js";
export { formatTracePageReport, formatTraceReport } from "./trace-command.js";
export { formatSearchQualityReport } from "./search-command.js";
export { formatDoctorReport } from "./doctor-command.js";
export { formatEnvironmentObservation } from "./environment-command.js";
export { runRepositoryCommand } from "./repository-command.js";
export type { CliIo, CliServiceOverrides, CliServices } from "./types.js";
