import { randomBytes } from "node:crypto";
import type { WorkResponsibilityV1 } from "@lervo/application-contract";
import { openProjectStorage } from "@lervo/project-storage";
import { operatingContractHash } from "@lervo/work-controller";
import type { NodeSupervisionBinding } from "../src/supervision-authority.js";

/** Seeds the reader contract only; this is not a production responsibility-installation path. */
export async function recordResponsibilityFixture(input: {
  root: string;
  binding: NodeSupervisionBinding;
  workstreamRevision: number;
  causationEventIds: string[];
  responsibility: WorkResponsibilityV1;
}) {
  const storage = await openProjectStorage(input.root);
  try {
    const task = input.responsibility;
    const artifact = await storage.artifacts.put(JSON.stringify(task, null, 2) + "\n");
    const event = storage.events.append({
      eventId: `evt_${randomBytes(16).toString("hex")}`,
      projectId: storage.manifest.projectId,
      runId: `run_${operatingContractHash({ supervisionId: input.binding.supervisionId }).slice(7, 39)}`,
      sessionId: "ses_responsibility_fixture",
      schemaVersion: 3,
      type: "work.responsibility.bound",
      occurredAt: new Date().toISOString(),
      actor: { kind: "system" },
      policyVersion: operatingContractHash("fixture"),
      payload: {
        schemaVersion: 1,
        ...input.binding,
        projectId: storage.manifest.projectId,
        workstreamRevision: input.workstreamRevision,
        causationEventIds: input.causationEventIds,
        assignmentId: task.assignmentId,
        assignmentRevision: task.assignmentRevision,
        executorAgentId: task.executorAgentId,
        reviewerAgentId: task.reviewerAgentId,
        roleId: task.roleId,
        roleVersion: task.roleVersion,
        roleContractHash: task.roleContractHash,
        responsibilityArtifactHash: artifact.contentHash,
        predecessorBindingHash: task.predecessorBindingHash,
      },
    }).event;
    return { artifact, event };
  } finally {
    await storage.close();
  }
}
