import {
  listAgents,
  listAssignments,
  type WorkforceAgent,
  type WorkforceAssignment,
} from "@lervo/agent-workforce";
import type {
  GovernedLoopPolicyV1,
  GovernedWorkReportV1,
  UnattendedSchedulerAgentV1,
  UnattendedSchedulerAssignmentV1,
  UnattendedSchedulerResultReasonV1,
  UnattendedSchedulerResultV1,
  UnattendedSchedulerSelectionV1,
} from "@lervo/application-contract";
import { selectUnattendedSchedulerAction } from "@lervo/work-controller";

import {
  executeGovernedAttempt,
  type GovernedAttemptRunResult,
  type GovernedAttemptServices,
} from "./governed-attempt-runner.js";
import { finalizeGovernedAssignment } from "./governed-assignment-finalization.js";
import { inspectGovernedWork } from "./governed-work-inspection.js";
import { executeManagedRun, type RunProvider } from "./managed-run.js";
import {
  claimUnattendedAssignment,
  isRecoverableUnattendedClaimRace,
  type ClaimUnattendedAssignment,
} from "./unattended-assignment-claim.js";
import { unattendedAssignmentInstructions } from "./unattended-assignment-instructions.js";
import {
  openUnattendedSchedulerRuntime,
  type UnattendedSchedulerRuntime,
} from "./unattended-scheduler-runtime.js";
import {
  unattendedSchedulerAgent,
  unattendedSchedulerAssignment,
} from "./unattended-scheduler-snapshots.js";

export interface UnattendedSchedulerRequest {
  repositoryRoot: string;
  policy: Partial<GovernedLoopPolicyV1>;
  provider: RunProvider;
  eligibleAgentIds: string[];
  pollIntervalMs: number;
  maximumCycles: number;
  maximumClaims: number;
  maximumManagedRuns: number;
  maximumRuntimeMs: number;
  maximumConsecutiveFailures: number;
  leaseDurationMs: number;
  killSwitchPath: string;
  risk: string;
}

export type ExecuteUnattendedScheduler = (
  request: UnattendedSchedulerRequest,
) => Promise<UnattendedSchedulerResultV1>;

interface UnattendedSchedulerDependencies extends GovernedAttemptServices {
  listAgents(root: string): Promise<WorkforceAgent[]>;
  listAssignments(root: string): Promise<WorkforceAssignment[]>;
  claimAssignment: ClaimUnattendedAssignment;
  openRuntime(input: {
    repositoryRoot: string;
    killSwitchPath: string;
  }): Promise<UnattendedSchedulerRuntime>;
}

interface SchedulerCounts {
  cycles: number;
  claims: number;
  managedRuns: number;
  completedAssignments: number;
  retryRuns: number;
  recoverableRaces: number;
  consecutiveFailures: number;
}

const defaultDependencies: UnattendedSchedulerDependencies = {
  inspectGovernedWork,
  executeManagedRun,
  finalizeGovernedAssignment,
  listAgents,
  listAssignments,
  claimAssignment: claimUnattendedAssignment,
  openRuntime: openUnattendedSchedulerRuntime,
};

function result(input: {
  request: UnattendedSchedulerRequest;
  runtime: UnattendedSchedulerRuntime;
  startedAt: string;
  status: UnattendedSchedulerResultV1["status"];
  reasonCode: UnattendedSchedulerResultReasonV1;
  counts: SchedulerCounts;
  lastSelection: UnattendedSchedulerSelectionV1 | null;
}): UnattendedSchedulerResultV1 {
  return {
    schemaVersion: 1,
    kind: "unattended_scheduler.result",
    status: input.status,
    reasonCode: input.reasonCode,
    schedulerSessionId: input.runtime.schedulerSessionId,
    startedAt: input.startedAt,
    finishedAt: input.runtime.now().toISOString(),
    counts: { ...input.counts },
    limits: {
      maximumCycles: input.request.maximumCycles,
      maximumClaims: input.request.maximumClaims,
      maximumManagedRuns: input.request.maximumManagedRuns,
      maximumRuntimeMs: input.request.maximumRuntimeMs,
      maximumConsecutiveFailures: input.request.maximumConsecutiveFailures,
    },
    lastSelection: input.lastSelection,
  };
}

function attention(
  request: UnattendedSchedulerRequest,
  runtime: UnattendedSchedulerRuntime,
  startedAt: string,
  counts: SchedulerCounts,
  lastSelection: UnattendedSchedulerSelectionV1 | null,
): UnattendedSchedulerResultV1 {
  return result({
    request,
    runtime,
    startedAt,
    status: "attention_required",
    reasonCode: "governed_attention_required",
    counts,
    lastSelection,
  });
}

async function observe(input: {
  request: UnattendedSchedulerRequest;
  dependencies: UnattendedSchedulerDependencies;
  schedulerSessionId: string;
}): Promise<{
  report: GovernedWorkReportV1;
  assignments: UnattendedSchedulerAssignmentV1[];
  agents: UnattendedSchedulerAgentV1[];
  selection: UnattendedSchedulerSelectionV1;
}> {
  const report = await input.dependencies.inspectGovernedWork({
    repositoryRoot: input.request.repositoryRoot,
    policy: input.request.policy,
  });
  const [assignments, agents] = await Promise.all([
    input.dependencies.listAssignments(input.request.repositoryRoot),
    input.dependencies.listAgents(input.request.repositoryRoot),
  ]);
  const schedulerAssignments = assignments.map(unattendedSchedulerAssignment);
  const schedulerAgents = agents.map(unattendedSchedulerAgent);
  return {
    report,
    assignments: schedulerAssignments,
    agents: schedulerAgents,
    selection: selectUnattendedSchedulerAction({
      schemaVersion: 1,
      schedulerSessionId: input.schedulerSessionId,
      provider: input.request.provider,
      eligibleAgentIds: input.request.eligibleAgentIds,
      report,
      assignments: schedulerAssignments,
      agents: schedulerAgents,
    }),
  };
}

function runtimeExceeded(runtime: UnattendedSchedulerRuntime, startedAt: string, limit: number) {
  return runtime.now().getTime() - Date.parse(startedAt) >= limit;
}

async function pauseReason(
  runtime: UnattendedSchedulerRuntime,
  startedAt: string,
  runtimeLimitMs: number,
): Promise<"kill_switch_engaged" | "runtime_limit" | null> {
  if (await runtime.killSwitchEngaged()) return "kill_switch_engaged";
  return runtimeExceeded(runtime, startedAt, runtimeLimitMs) ? "runtime_limit" : null;
}

async function waitForNextCycle(
  runtime: UnattendedSchedulerRuntime,
  request: UnattendedSchedulerRequest,
  allowChange = true,
): Promise<void> {
  if (allowChange && runtime.waitForChange !== undefined)
    await runtime.waitForChange(request.pollIntervalMs);
  else await runtime.sleep(request.pollIntervalMs);
}

export function createUnattendedSchedulerExecutor(
  dependencies: UnattendedSchedulerDependencies = defaultDependencies,
): ExecuteUnattendedScheduler {
  return async (request) => {
    const runtime = await dependencies.openRuntime({
      repositoryRoot: request.repositoryRoot,
      killSwitchPath: request.killSwitchPath,
    });
    const startedAt = runtime.now().toISOString();
    const counts: SchedulerCounts = {
      cycles: 0,
      claims: 0,
      managedRuns: 0,
      completedAssignments: 0,
      retryRuns: 0,
      recoverableRaces: 0,
      consecutiveFailures: 0,
    };
    let lastSelection: UnattendedSchedulerSelectionV1 | null = null;
    const finish = (
      status: UnattendedSchedulerResultV1["status"],
      reasonCode: UnattendedSchedulerResultReasonV1,
    ) => result({ request, runtime, startedAt, status, reasonCode, counts, lastSelection });

    try {
      while (true) {
        const cyclePause = await pauseReason(runtime, startedAt, request.maximumRuntimeMs);
        if (cyclePause !== null) return finish("paused", cyclePause);
        if (counts.cycles >= request.maximumCycles) return finish("paused", "cycle_limit");
        counts.cycles += 1;
        let observation = await observe({
          request,
          dependencies,
          schedulerSessionId: runtime.schedulerSessionId,
        });
        lastSelection = observation.selection;

        if (lastSelection.kind === "stop") {
          return lastSelection.reasonCode === "work_complete"
            ? finish("completed", "work_complete")
            : attention(request, runtime, startedAt, counts, lastSelection);
        }
        if (lastSelection.kind === "wait") {
          await waitForNextCycle(runtime, request);
          continue;
        }
        if (lastSelection.kind === "claim_assignment") {
          if (counts.claims >= request.maximumClaims) return finish("paused", "claim_limit");
          const claimPause = await pauseReason(runtime, startedAt, request.maximumRuntimeMs);
          if (claimPause !== null) return finish("paused", claimPause);
          try {
            await dependencies.claimAssignment({
              repositoryRoot: request.repositoryRoot,
              assignmentId: lastSelection.assignmentId,
              expectedRevision: lastSelection.expectedAssignmentRevision,
              agentId: lastSelection.agentId,
              sessionId: runtime.schedulerSessionId,
              leaseDurationMs: request.leaseDurationMs,
              now: runtime.now(),
            });
            counts.claims += 1;
            counts.consecutiveFailures = 0;
          } catch (error) {
            if (!isRecoverableUnattendedClaimRace(error)) throw error;
            counts.recoverableRaces += 1;
            counts.consecutiveFailures += 1;
            if (counts.consecutiveFailures >= request.maximumConsecutiveFailures) {
              return finish("attention_required", "consecutive_failure_limit");
            }
            await waitForNextCycle(runtime, request, false);
            continue;
          }
          if (await runtime.killSwitchEngaged()) return finish("paused", "kill_switch_engaged");
          observation = await observe({
            request,
            dependencies,
            schedulerSessionId: runtime.schedulerSessionId,
          });
          lastSelection = observation.selection;
          if (lastSelection.kind !== "execute_assignment") {
            return attention(request, runtime, startedAt, counts, lastSelection);
          }
        }

        if (counts.managedRuns >= request.maximumManagedRuns) {
          return finish("paused", "managed_run_limit");
        }
        const runPause = await pauseReason(runtime, startedAt, request.maximumRuntimeMs);
        if (runPause !== null) return finish("paused", runPause);
        const selected = lastSelection;
        const assignment = observation.assignments.find(
          (item) => item.assignmentId === selected.assignmentId,
        )!;
        const agent = observation.agents.find((item) => item.agentId === selected.agentId)!;
        counts.managedRuns += 1;
        if (selected.attemptKind === "retry_attempt") counts.retryRuns += 1;
        const run: GovernedAttemptRunResult = await executeGovernedAttempt(
          {
            repositoryRoot: request.repositoryRoot,
            policy: request.policy,
            provider: request.provider,
            assignmentId: selected.assignmentId,
            agentId: selected.agentId,
            leaseId: selected.leaseId,
            expectedPaths: assignment.expectedPaths,
            verificationSuiteIds: assignment.verificationSuiteIds,
            instructions: unattendedAssignmentInstructions(assignment),
            risk: request.risk,
            skillIds: agent.skillIds,
            capabilityIds: agent.capabilityIds,
            roleId: assignment.roleId,
          },
          observation.report,
          dependencies,
        );
        if (run.status === "completed") {
          counts.completedAssignments += 1;
          counts.consecutiveFailures = 0;
          continue;
        }
        const retryAvailable =
          (run.status === "execution_failed" &&
            (run.effectState === "not_started" || run.retryAvailable)) ||
          (run.status === "not_accepted" && run.retryAvailable);
        if (!retryAvailable) return attention(request, runtime, startedAt, counts, lastSelection);
        counts.consecutiveFailures += 1;
        if (counts.consecutiveFailures >= request.maximumConsecutiveFailures) {
          return finish("attention_required", "consecutive_failure_limit");
        }
        await waitForNextCycle(runtime, request);
      }
    } finally {
      await runtime.release();
    }
  };
}

export const executeUnattendedScheduler = createUnattendedSchedulerExecutor();
