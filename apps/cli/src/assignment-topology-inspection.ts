import type { WorkGraphV2 } from "@lervo/application-contract";
import { listAssignments, type WorkforceAssignment } from "@lervo/agent-workforce";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { collectEventsOfTypesBounded } from "@lervo/storage-contract";
import {
  managedAttemptEventTypes,
  projectManagedAttempts,
  projectWorkGraphV2,
  workGraphV2EventTypes,
} from "@lervo/work-controller";

import { verifiedCurrentWorkstream } from "./workstream-services.js";

/** Bounds the attempt and topology events retained, never the length of project history. */
const maximumSourceEvents = 100_000;
const topologySourceEventTypes = [
  ...new Set([...managedAttemptEventTypes, ...workGraphV2EventTypes]),
];

export async function loadAssignmentTopologySnapshot(storage: ProjectStorage): Promise<{
  graph: WorkGraphV2;
  assignments: WorkforceAssignment[];
}> {
  const workstream = await verifiedCurrentWorkstream(storage);
  if (workstream === null || workstream.status !== "active")
    throw new Error("Assignment topology requires one verified active workstream.");
  const assignments = await listAssignments(storage.paths.repositoryRoot);
  const events = collectEventsOfTypesBounded({
    events: storage.events,
    types: topologySourceEventTypes,
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
