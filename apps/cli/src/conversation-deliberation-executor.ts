import type {
  ConversationDeliberationExecutionPort,
  ConversationDeliberationJob,
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

export {
  ManagedConversationDeliberationExecutionError,
  type ManagedConversationDeliberationProjectBinding,
} from "./conversation-deliberation-projects.js";

export function createManagedConversationDeliberationExecutionAdapter(options: {
  projects: readonly ManagedConversationDeliberationProjectBinding[];
  executeAssigned?: ExecuteAssignedManagedDeliberation;
}): ConversationDeliberationExecutionPort {
  const projects = new ManagedConversationDeliberationProjects(options.projects);
  const executeAssigned = options.executeAssigned ?? createAssignedManagedDeliberationExecutor();

  return {
    async execute(job: Readonly<ConversationDeliberationJob>): Promise<ConversationDeliberationSummary> {
      const repositoryRoot = projects.require(job.projectId);
      if (
        job.state !== "leased" ||
        !/^dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(job.deliberationId) ||
        !/^deliberation_[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(job.policyId) ||
        job.topic.trim().length === 0 || job.topic.length > 4_096
      ) {
        throw new ManagedConversationDeliberationExecutionError(
          "deliberation_job_invalid",
          "실행할 대화 숙의 job이 유효하지 않습니다.",
        );
      }
      const outcome = await executeAssigned({
        deliberationId: job.deliberationId,
        expectedProjectId: job.projectId,
        request: {
          repositoryRoot,
          policyId: job.policyId,
          topic: job.topic,
        },
      });
      if (
        outcome.deliberationId !== job.deliberationId ||
        !Number.isSafeInteger(outcome.artifactCount) ||
        outcome.artifactCount < 0 || outcome.artifactCount > 10_000
      ) {
        throw new ManagedConversationDeliberationExecutionError(
          "deliberation_job_invalid",
          "Managed 숙의 결과 좌표가 queue job과 일치하지 않습니다.",
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
