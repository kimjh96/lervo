import type {
  ConversationDeliberationResumeExecutionPort,
  ConversationDeliberationResumeJob,
  ConversationDeliberationSummary,
} from "@lervo/conversation-control";

import {
  createAssignedManagedDeliberationExecutor,
  type ExecuteAssignedManagedDeliberation,
} from "./managed-deliberation.js";
import {
  ManagedConversationDeliberationExecutionError,
  ManagedConversationDeliberationProjects,
  type ManagedConversationDeliberationProjectBinding,
} from "./conversation-deliberation-projects.js";

export function createManagedConversationDeliberationResumeExecutionAdapter(options: {
  projects: readonly ManagedConversationDeliberationProjectBinding[];
  executeAssignedResume?: ExecuteAssignedManagedDeliberation;
}): ConversationDeliberationResumeExecutionPort {
  const projects = new ManagedConversationDeliberationProjects(options.projects);
  const executeAssignedResume =
    options.executeAssignedResume ?? createAssignedManagedDeliberationExecutor();

  return {
    async execute(
      job: Readonly<ConversationDeliberationResumeJob>,
    ): Promise<ConversationDeliberationSummary> {
      const repositoryRoot = projects.require(job.projectId);
      if (job.state !== "leased") {
        throw new ManagedConversationDeliberationExecutionError(
          "deliberation_job_invalid",
          "The conversation deliberation resume job is invalid.",
        );
      }
      const outcome = await executeAssignedResume({
        deliberationId: job.deliberationId,
        expectedProjectId: job.projectId,
        request: {
          repositoryRoot,
          resumeDeliberationId: job.deliberationId,
        },
      });
      if (
        outcome.deliberationId !== job.deliberationId ||
        !Number.isSafeInteger(outcome.artifactCount) ||
        outcome.artifactCount < 0 ||
        outcome.artifactCount > 10_000
      ) {
        throw new ManagedConversationDeliberationExecutionError(
          "deliberation_job_invalid",
          "The managed deliberation resume result coordinates do not match the queue job.",
        );
      }
      return {
        deliberationId: job.deliberationId,
        status: outcome.status,
        artifactCount: outcome.artifactCount,
        nextAction: "none",
      };
    },
  };
}
