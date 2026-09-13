import { observeUnstartedSupervisionWorkspace } from "./supervision-unstarted-workspace.js";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import { listWorkspaces, type WorkforceAssignment } from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";

/** Retains earlier result checkouts; only a workspace bound to the current lease can execute. */
export async function currentSupervisionWorkspaces(
  root: string,
  assignment: WorkforceAssignment,
  binding?: NodeSupervisionBinding,
  storage?: ProjectStorage,
) {
  const all = (await listWorkspaces(root)).filter(
    (item) => item.assignmentId === assignment.assignmentId && item.state !== "removed",
  );
  const current = all.filter((item) => item.leaseGeneration === assignment.lease?.generation);
  const previous = all.filter((item) => !current.includes(item));
  for (let offset = 0; offset < previous.length; offset += 4) {
    const results = await Promise.allSettled(
      previous.slice(offset, offset + 4).map(async (item) => {
        const settledAttempt =
          assignment.recovery !== undefined &&
          item.leaseGeneration <= assignment.recovery.predecessorLeaseGeneration &&
          ["ready", "paused"].includes(item.state) &&
          item.writerSession === null &&
          item.recoveryReason === null;
        if (settledAttempt) return;
        if (
          binding !== undefined &&
          item.leaseGeneration < (assignment.lease?.generation ?? 0) &&
          (await observeUnstartedSupervisionWorkspace({
            repositoryRoot: root,
            binding,
            assignment,
            workspace: item,
            ...(storage === undefined ? {} : { storage }),
          })) !== null
        )
          return;
        throw new Error("An earlier workspace generation has unresolved execution authority.");
      }),
    );
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
    }
  }
  return current;
}
