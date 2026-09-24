import type { AgentWorkspace, WorkforceAssignment } from "@lervo/agent-workforce";
import { observeUnstartedSupervisionWorkspace } from "./supervision-unstarted-workspace.js";

const workspaceObservationConcurrency = 4;

/**
 * Observes retained checkouts in bounded parallel, preserving input order. Each observation keeps
 * its own freshness bound; serial Git inspection grows linearly with retained workspaces.
 */
export async function observeUnstartedSupervisionWorkspaces(
  input: Omit<
    Parameters<typeof observeUnstartedSupervisionWorkspace>[0],
    "assignment" | "workspace"
  > & {
    candidates: readonly { assignment: WorkforceAssignment; workspace: AgentWorkspace }[];
  },
) {
  const { candidates, ...shared } = input;
  const proofs: Awaited<ReturnType<typeof observeUnstartedSupervisionWorkspace>>[] = new Array(
    candidates.length,
  ).fill(null);
  let next = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(workspaceObservationConcurrency, candidates.length) },
      async () => {
        while (next < candidates.length) {
          const index = next++;
          proofs[index] = await observeUnstartedSupervisionWorkspace({
            ...shared,
            ...candidates[index]!,
          });
        }
      },
    ),
  );
  return proofs.filter((proof) => proof !== null);
}
