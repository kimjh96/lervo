import { listAssignments, listWorkspaceIntegrationAttempts } from "@lervo/agent-workforce";
import { repositoryCoordinateDigest } from "@lervo/project-storage";

import { loadConvergenceDelegation } from "./delegation.js";
import { releaseOrphanedConvergenceIntegrationAttempts } from "./integration-attempt-release.js";

const BLOCKING = new Set(["leased", "candidate", "conflict", "advancing"]);

/**
 * An integrator assignment failed as uncertain because an earlier lease's attempt on the
 * integration target never finished. The owner never replans a stalled stage, so the attempt sweep
 * that runs before planning would never see it: this inspection runs the same sweep. The stall is
 * settled only when no unfinished attempt remains on the target and some attempt there was
 * released after the failure. A release that the failure already saw cannot settle it again, so a
 * stage that keeps failing is not requeued in a loop, while a release that another sweep made, or
 * that a stopped inspection made before it could answer, still counts.
 */
export async function releasedIntegrationStall(
  root: string,
  failure: { assignmentId?: unknown; returnedAt?: unknown },
): Promise<boolean> {
  const failedAt = Date.parse(String(failure.returnedAt));
  if (!Number.isFinite(failedAt)) return false;
  const assignment = (await listAssignments(root)).find(
    (item) => item.assignmentId === failure.assignmentId,
  );
  if (assignment?.taskType !== "repository.integration") return false;
  const authority = await loadConvergenceDelegation(root);
  if (!authority) return false;
  const ref = authority.delegation.integrationTarget.ref;
  await releaseOrphanedConvergenceIntegrationAttempts(root, ref);
  const digest = repositoryCoordinateDigest(ref);
  const attempts = (await listWorkspaceIntegrationAttempts(root)).filter(
    (attempt) => attempt.targetDigest === digest,
  );
  return (
    !attempts.some((attempt) => BLOCKING.has(attempt.state)) &&
    attempts.some(
      (attempt) => attempt.state === "released" && Date.parse(attempt.updatedAt) > failedAt,
    )
  );
}
