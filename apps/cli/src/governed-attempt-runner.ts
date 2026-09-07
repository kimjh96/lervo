import type { GovernedWorkReportV1 } from "@lervo/application-contract";
import { planGovernedAttemptCommand } from "@lervo/work-controller";

import type { ManagedRunOutcome } from "./managed-run.js";
import type { CliServices } from "./types.js";

import type { GovernedLoopPolicyV1 } from "@lervo/application-contract";
import type { RunProvider } from "./managed-run.js";

export interface GovernedAttemptRequest {
  repositoryRoot: string;
  policy: Partial<GovernedLoopPolicyV1>;
  provider: RunProvider;
  assignmentId: string;
  agentId: string;
  leaseId: string;
  expectedPaths: string[];
  verificationSuiteIds: string[];
  instructions: string;
  risk: string;
  skillIds: string[];
  capabilityIds: string[];
  roleId?: string;
}

export type GovernedAttemptServices = Pick<
  CliServices,
  "executeManagedRun" | "finalizeGovernedAssignment" | "inspectGovernedWork"
>;
const budgetFailureReasons = [
  "token_budget_exhausted",
  "duration_budget_exhausted",
  "budget_observation_unavailable",
] as const;
type BudgetFailureReason = (typeof budgetFailureReasons)[number];

export type GovernedAttemptRunResult =
  | { status: "completed"; assignmentId: string; outcome: ManagedRunOutcome }
  | {
      status: "execution_failed";
      code: string;
      attemptRecorded: boolean;
      effectState: "not_started" | "terminal_failed" | "uncertain";
      retryAvailable: boolean;
      report: GovernedWorkReportV1;
    }
  | {
      status: "not_accepted";
      outcome: ManagedRunOutcome;
      retryAvailable: boolean;
      report: GovernedWorkReportV1;
    }
  | {
      status: "budget_rejected";
      reasonCode: BudgetFailureReason;
      outcome: ManagedRunOutcome;
      report: GovernedWorkReportV1;
    };

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(code)
    ? code
    : "governed_attempt_failed";
}

function runSucceeded(outcome: ManagedRunOutcome): boolean {
  return outcome.verificationStatus === "passed" && outcome.writingPublication.status === "allowed";
}

function isBudgetFailureReason(value: string): value is BudgetFailureReason {
  return budgetFailureReasons.some((reason) => reason === value);
}

function managedBudgetFailure(
  report: GovernedWorkReportV1,
): { reasonCode: BudgetFailureReason } | undefined {
  for (const action of report.decision.actions) {
    if (
      (action.kind === "block" || action.kind === "escalate") &&
      isBudgetFailureReason(action.reasonCode)
    ) {
      return { reasonCode: action.reasonCode };
    }
  }
  return undefined;
}

export async function executeGovernedAttempt(
  options: GovernedAttemptRequest,
  report: GovernedWorkReportV1,
  services: GovernedAttemptServices,
): Promise<GovernedAttemptRunResult> {
  const command = planGovernedAttemptCommand({ report, assignmentId: options.assignmentId });
  const node = report.graph.nodes.find(
    (candidate) => candidate.assignmentId === options.assignmentId,
  )!;
  if (
    node.assigneeAgentId !== options.agentId ||
    node.leaseId !== options.leaseId ||
    command.causality.agentId !== options.agentId
  ) {
    throw new Error("The governed attempt differs from the active assignment lease.");
  }
  const rechecked = await services.inspectGovernedWork({
    repositoryRoot: options.repositoryRoot,
    policy: options.policy,
  });
  const currentCommand = planGovernedAttemptCommand({
    report: rechecked,
    assignmentId: options.assignmentId,
  });
  if (
    currentCommand.commandId !== command.commandId ||
    currentCommand.expectedGraphHash !== command.expectedGraphHash
  ) {
    throw new Error("The governed attempt command became stale before provider execution.");
  }

  let outcome: ManagedRunOutcome;
  try {
    outcome = await services.executeManagedRun({
      repositoryRoot: options.repositoryRoot,
      provider: options.provider,
      expectedPaths: options.expectedPaths,
      instructions: options.instructions,
      risk: options.risk,
      skillIds: options.skillIds,
      capabilityIds: options.capabilityIds,
      verificationSuiteIds: options.verificationSuiteIds,
      roleId: options.roleId ?? node.roleId,
      workforce: {
        assignmentId: options.assignmentId,
        agentId: options.agentId,
        leaseId: options.leaseId,
      },
      workCausality: command.causality,
      assignmentFinalization: "governed",
    });
  } catch (error) {
    const refreshed = await services.inspectGovernedWork({
      repositoryRoot: options.repositoryRoot,
      policy: options.policy,
    });
    const attemptRecorded =
      (refreshed.graph.nodes.find((candidate) => candidate.assignmentId === options.assignmentId)
        ?.attemptCount ?? 0) > node.attemptCount;
    const retryAvailable = refreshed.decision.actions.some(
      (candidate) =>
        candidate.kind === "retry_attempt" && candidate.assignmentId === options.assignmentId,
    );
    const latestAttempt = refreshed.attempts
      .filter((candidate) => candidate.assignmentId === options.assignmentId)
      .sort((left, right) => right.attemptOrdinal - left.attemptOrdinal)[0];
    const effectState = !attemptRecorded
      ? "not_started"
      : latestAttempt?.terminalStatus === "failed"
        ? "terminal_failed"
        : "uncertain";
    if (effectState === "terminal_failed" && !retryAvailable) {
      await services.finalizeGovernedAssignment({
        repositoryRoot: options.repositoryRoot,
        assignmentId: options.assignmentId,
        agentId: options.agentId,
        leaseId: options.leaseId,
        verificationStatus: "failed",
        resultArtifacts: [],
        failureCode: errorCode(error),
      });
    }
    return {
      status: "execution_failed",
      code: errorCode(error),
      attemptRecorded,
      effectState,
      retryAvailable,
      report: refreshed,
    };
  }

  if (runSucceeded(outcome)) {
    if (
      (options.policy.tokenLimits?.length ?? 0) +
        (options.policy.tokenMetricLimits?.length ?? 0) +
        (options.policy.durationLimits?.length ?? 0) >
      0
    ) {
      const refreshed = await services.inspectGovernedWork({
        repositoryRoot: options.repositoryRoot,
        policy: options.policy,
      });
      const budgetFailure = managedBudgetFailure(refreshed);
      if (budgetFailure !== undefined) {
        await services.finalizeGovernedAssignment({
          repositoryRoot: options.repositoryRoot,
          assignmentId: options.assignmentId,
          agentId: options.agentId,
          leaseId: options.leaseId,
          verificationStatus: "failed",
          resultArtifacts: [
            {
              artifactId: outcome.resultArtifact.artifactId,
              contentHash: outcome.resultArtifact.contentHash,
            },
          ],
          failureCode: budgetFailure.reasonCode,
        });
        return {
          status: "budget_rejected",
          reasonCode: budgetFailure.reasonCode,
          outcome,
          report: refreshed,
        };
      }
    }
    await services.finalizeGovernedAssignment({
      repositoryRoot: options.repositoryRoot,
      assignmentId: options.assignmentId,
      agentId: options.agentId,
      leaseId: options.leaseId,
      verificationStatus: "passed",
      resultArtifacts: [
        {
          artifactId: outcome.resultArtifact.artifactId,
          contentHash: outcome.resultArtifact.contentHash,
        },
      ],
      completionEvidence: {
        workstreamId: report.workstreamId,
        assignmentRevision: node.assignmentRevision,
        runId: outcome.runId,
        sessionId: outcome.sessionId,
        writingPublicationStatus: "allowed",
      },
    });
    return { status: "completed", assignmentId: options.assignmentId, outcome };
  }

  const refreshed = await services.inspectGovernedWork({
    repositoryRoot: options.repositoryRoot,
    policy: options.policy,
  });
  const retryAvailable =
    outcome.verificationStatus !== "passed" &&
    refreshed.decision.actions.some(
      (candidate) =>
        candidate.kind === "retry_attempt" && candidate.assignmentId === options.assignmentId,
    );
  if (!retryAvailable) {
    await services.finalizeGovernedAssignment({
      repositoryRoot: options.repositoryRoot,
      assignmentId: options.assignmentId,
      agentId: options.agentId,
      leaseId: options.leaseId,
      verificationStatus: "failed",
      resultArtifacts: [
        {
          artifactId: outcome.resultArtifact.artifactId,
          contentHash: outcome.resultArtifact.contentHash,
        },
      ],
      failureCode: "governed_attempt_not_accepted",
    });
  }
  return { status: "not_accepted", outcome, retryAvailable, report: refreshed };
}
