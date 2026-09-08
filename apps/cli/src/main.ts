import { openProjectStorage } from "@lervo/project-storage";

import {
  agentOrganizationUsage,
  runAgentOrganizationCommand,
} from "./agent-organization-command.js";
import { applicationUsage, runApplicationCommand } from "./application-command.js";
import { doctorUsage, runDoctorCommand } from "./doctor-command.js";
import { capabilityUsage, runCapabilityCommand } from "./capability-command.js";
import { deliberateUsage, runDeliberateCommand } from "./deliberate-command.js";
import { inspectDoctorEnvironment } from "./doctor-environment.js";
import { finalizeGovernedAssignment } from "./governed-assignment-finalization.js";
import { reconcileGovernedAssignment } from "./governed-completion-reconciliation.js";
import { inspectGovernedWork } from "./governed-work-inspection.js";
import { inspectOperatingObjective } from "./operating-objective-inspection.js";
import { inspectOperatingGoal } from "./operating-goal-inspection.js";
import { inspectOperatingAttention } from "./operating-attention-inspection.js";
import { inspectOperatingLiveness } from "./operating-liveness-inspection.js";
import { inspectAssignmentCommunications } from "./assignment-communication-inspection.js";
import {
  assignmentCommunicationUsage,
  runAssignmentCommunicationCommand,
} from "./assignment-communication-command.js";
import {
  assignmentMessageTriggerUsage,
  runAssignmentMessageTriggerCommand,
} from "./assignment-message-trigger-command.js";
import {
  assignmentRoutineUsage,
  runAssignmentRoutineCommand,
} from "./assignment-routine-command.js";
import {
  assignmentTopologyUsage,
  runAssignmentTopologyCommand,
} from "./assignment-topology-command.js";
import {
  assignmentConnectorUsage,
  runAssignmentConnectorCommand,
} from "./assignment-connector-command.js";
import { runInitCommand, initUsage } from "./init-command.js";
import { runLoopCommand, loopUsage } from "./loop-command.js";
import { liveTriggerUsage, runLiveTriggerCommand } from "./live-trigger-command.js";
import { executeManagedRun } from "./managed-run.js";
import {
  createAssignedManagedDeliberationExecutor,
  executeManagedDeliberation,
} from "./managed-deliberation.js";
import { executeUnattendedScheduler } from "./unattended-scheduler.js";
import { environmentUsage, runEnvironmentCommand } from "./environment-command.js";
import { eventContractUsage, runEventContractCommand } from "./event-contract-command.js";
import { executeEnvironmentQuery } from "./environment-services.js";
import { migrateUsage, runMigrateCommand } from "./migrate-command.js";
import { knowledgeUsage, runKnowledgeCommand } from "./knowledge-command.js";
import { readmeUsage, runReadmeCommand } from "./readme-command.js";
import { roleUsage, runRoleCommand } from "./role-command.js";
import { repositoryUsage, runRepositoryCommand } from "./repository-command.js";
import { runManagedCommand, runUsage } from "./run-command.js";
import { runSearchCommand, searchUsage } from "./search-command.js";
import { runStateCommand, stateUsage } from "./state-command.js";
import { runTraceCommand, traceUsage } from "./trace-command.js";
import { runTerminalCommand, terminalUsage } from "./terminal-command.js";
import { createTerminalStageObservation } from "./terminal-stage-observation.js";
import type { CliIo, CliServiceOverrides, CliServices } from "./types.js";
import { groundProductionRequest } from "./semantic-grounding.js";
import {
  prepareProductionSearchQueries,
  projectProductionSearchQueries,
} from "./provider-query-projector.js";
import { runUpgradeCommand, upgradeUsage } from "./upgrade-command.js";
import { runVersionCommand, versionUsage } from "./version-command.js";
import { runWorkstreamCommand, workstreamUsage } from "./workstream-command.js";
import { runWorkspaceCommand, workspaceUsage } from "./workspace-command.js";
import { runWorkforceCommand, workforceUsage } from "./workforce-command.js";

const usage = `Usage:
${versionUsage}
${initUsage}
${upgradeUsage}
${migrateUsage}
${knowledgeUsage}
${applicationUsage}
${loopUsage}
${liveTriggerUsage}
${runUsage}
${deliberateUsage}
${traceUsage}
${searchUsage}
${stateUsage}
${doctorUsage}
${capabilityUsage}
${environmentUsage}
${eventContractUsage}
${repositoryUsage}
${terminalUsage}
${workstreamUsage}
${workspaceUsage}
${workforceUsage}
${agentOrganizationUsage}
${assignmentCommunicationUsage}
${assignmentMessageTriggerUsage}
${assignmentConnectorUsage}
${assignmentRoutineUsage}
${assignmentTopologyUsage}
${roleUsage}
${readmeUsage}
`;

const defaultServices: CliServices = {
  executeManagedRun,
  executeManagedDeliberation,
  executeAssignedManagedDeliberation: createAssignedManagedDeliberationExecutor(),
  executeUnattendedScheduler,
  openProjectStorage,
  inspectDoctorEnvironment,
  executeEnvironmentQuery,
  groundProductionRequest,
  projectSearchQueries: projectProductionSearchQueries,
  createTerminalStageObservation,
  inspectGovernedWork,
  inspectOperatingObjective,
  inspectOperatingGoal,
  inspectOperatingAttention,
  inspectOperatingLiveness,
  inspectAssignmentCommunications,
  finalizeGovernedAssignment,
  reconcileGovernedAssignment,
  prepareSearchQueries: prepareProductionSearchQueries,
  createLocalImprovementObservationHost: async (input) => {
    const { createLocalImprovementObservationHost } =
      await import("./local-improvement-observation-host.js");
    return createLocalImprovementObservationHost(input);
  },
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
  if (command === "upgrade") return runUpgradeCommand(args.slice(1), io);
  if (command === "migrate") return runMigrateCommand(args.slice(1), io);
  if (command === "knowledge") return runKnowledgeCommand(args.slice(1), io, services);
  if (command === "application") return runApplicationCommand(args.slice(1), io, services);
  if (command === "loop") return runLoopCommand(args.slice(1), io, services);
  if (command === "trigger") return runLiveTriggerCommand(args.slice(1), io);
  if (command === "run") return runManagedCommand(args.slice(1), io, services);
  if (command === "deliberate") return runDeliberateCommand(args.slice(1), io, services);
  if (command === "trace") return runTraceCommand(args.slice(1), io, services);
  if (command === "search") return runSearchCommand(args.slice(1), io);
  if (command === "state") return runStateCommand(args.slice(1), io);
  if (command === "doctor") return runDoctorCommand(args.slice(1), io, services);
  if (command === "capability") return runCapabilityCommand(args.slice(1), io);
  if (command === "environment") return runEnvironmentCommand(args.slice(1), io, services);
  if (command === "event-contract") return runEventContractCommand(args.slice(1), io);
  if (command === "repository") return runRepositoryCommand(args.slice(1), io);
  if (command === "terminal") return runTerminalCommand(args.slice(1), io, services);
  if (command === "workstream") return runWorkstreamCommand(args.slice(1), io);
  if (command === "workspace") return runWorkspaceCommand(args.slice(1), io);
  if (command === "assignment" && args[1] === "mention") {
    return runAssignmentCommunicationCommand(args.slice(1), io);
  }
  if (command === "assignment" && args[1] === "trigger") {
    return runAssignmentMessageTriggerCommand(
      args.slice(1),
      io,
      services.assignmentMessageTriggerAdapter,
    );
  }
  if (command === "assignment" && args[1] === "connector") {
    return runAssignmentConnectorCommand(args.slice(1), io, services);
  }
  if (command === "assignment" && args[1] === "topology") {
    return runAssignmentTopologyCommand(args.slice(2), io);
  }
  if (command === "routine") return runAssignmentRoutineCommand(args.slice(1), io);
  if (command === "workforce" || command === "agent" || command === "assignment")
    return runWorkforceCommand(command, args.slice(1), io, services);
  if (command === "organization") return runAgentOrganizationCommand(args.slice(1), io);
  if (command === "role") return runRoleCommand(args.slice(1), io);
  if (command === "readme") return runReadmeCommand(args.slice(1), io);
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
export {
  DisabledTerminalStageObservation,
  TerminalStageObservation,
} from "./terminal-stage-observation.js";
export type { CliIo, CliServiceOverrides, CliServices } from "./types.js";
