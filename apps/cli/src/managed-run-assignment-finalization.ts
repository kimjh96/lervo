import { completeAssignment } from "@lervo/agent-workforce";
import type { ManagedProviderResultArtifact } from "@lervo/orchestrator";
import type { ProjectStorage } from "@lervo/project-storage";

import { recordWorkforceEvent } from "./workforce-events.js";

export async function finalizeImmediateManagedAssignment(input: {
  storage: ProjectStorage;
  workforce: { assignmentId: string; agentId: string; leaseId: string };
  resultArtifact: ManagedProviderResultArtifact;
  verificationStatus: "passed" | "failed" | "not_run";
  writingPublicationStatus: "allowed" | "blocked";
  now: Date;
}): Promise<void> {
  const accepted =
    input.verificationStatus === "passed" && input.writingPublicationStatus === "allowed";
  await completeAssignment({
    repositoryRoot: input.storage.paths.repositoryRoot,
    assignmentId: input.workforce.assignmentId,
    agentId: input.workforce.agentId,
    leaseId: input.workforce.leaseId,
    resultArtifacts: [
      {
        artifactId: input.resultArtifact.artifactId,
        contentHash: input.resultArtifact.contentHash,
      },
    ],
    verificationStatus: accepted ? "passed" : "failed",
    ...(accepted ? {} : { failureCode: "managed_run_not_publishable" }),
    now: input.now,
    recordEvent: (event) => recordWorkforceEvent(input.storage, event),
  });
}
