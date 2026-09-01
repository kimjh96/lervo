import type { GovernedWorkReportV1 } from "@lervo/application-contract";
import { planGovernedAttemptCommand } from "@lervo/work-controller";

import type { ParsedLoopOptions } from "./loop-options.js";
import type { ManagedRunOutcome } from "./managed-run.js";
import type { CliServices } from "./types.js";

type RunOptions = Extract<ParsedLoopOptions, { action: "run" }>;

export type GovernedAttemptRunResult =
  | { status: "completed"; assignmentId: string; outcome: ManagedRunOutcome }
  | {
      status: "execution_failed";
      code: string;
      attemptRecorded: boolean;
      retryAvailable: boolean;
      report: GovernedWorkReportV1;
    }
  | {
      status: "not_accepted";
      outcome: ManagedRunOutcome;
      retryAvailable: boolean;
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

export async function executeGovernedAttempt(
  options: RunOptions,
  report: GovernedWorkReportV1,
  services: CliServices,
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
      expectedPath: options.expectedPath,
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
    if (attemptRecorded && !retryAvailable) {
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
      retryAvailable,
      report: refreshed,
    };
  }

  if (runSucceeded(outcome)) {
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
