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
  const executeAssignedResume = options.executeAssignedResume ??
    createAssignedManagedDeliberationExecutor();

  return {
    async execute(
      job: Readonly<ConversationDeliberationResumeJob>,
    ): Promise<ConversationDeliberationSummary> {
      const repositoryRoot = projects.require(job.projectId);
      if (job.state !== "leased") {
        throw new ManagedConversationDeliberationExecutionError(
          "deliberation_job_invalid",
          "실행할 대화 숙의 재개 job이 유효하지 않습니다.",
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
      if (outcome.deliberationId !== job.deliberationId ||
        !Number.isSafeInteger(outcome.artifactCount) || outcome.artifactCount < 0 ||
        outcome.artifactCount > 10_000) {
        throw new ManagedConversationDeliberationExecutionError(
          "deliberation_job_invalid",
          "Managed 숙의 재개 결과 좌표가 queue job과 일치하지 않습니다.",
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
