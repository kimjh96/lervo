import type { WorkGraphV2 } from "@lervo/application-contract";
import { listAssignments, type WorkforceAssignment } from "@lervo/agent-workforce";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { collectProjectEventsBounded } from "@lervo/storage-contract";
import { projectManagedAttempts, projectWorkGraphV2 } from "@lervo/work-controller";

import { verifiedCurrentWorkstream } from "./workstream-services.js";

const maximumSourceEvents = 100_000;

export async function loadAssignmentTopologySnapshot(storage: ProjectStorage): Promise<{
  graph: WorkGraphV2;
  assignments: WorkforceAssignment[];
}> {
  const workstream = await verifiedCurrentWorkstream(storage);
  if (workstream === null || workstream.status !== "active")
    throw new Error("Assignment topology requires one verified active workstream.");
  const assignments = await listAssignments(storage.paths.repositoryRoot);
  const events = collectProjectEventsBounded({
    events: storage.events,
    maximumEvents: maximumSourceEvents,
  });
  const attempts = projectManagedAttempts({
    events,
    workstreamId: workstream.workstreamId,
  }).attempts;
  return {
    assignments,
    graph: projectWorkGraphV2({
      projectId: storage.manifest.projectId,
      workstreamId: workstream.workstreamId,
      assignments,
      attempts,
      events,
      observedAt: new Date().toISOString(),
    }),
  };
}

export async function inspectAssignmentTopology(repositoryRoot: string): Promise<WorkGraphV2> {
  const storage = await openProjectStorage(repositoryRoot);
  try {
    return (await loadAssignmentTopologySnapshot(storage)).graph;
  } finally {
    await storage.close();
  }
}
