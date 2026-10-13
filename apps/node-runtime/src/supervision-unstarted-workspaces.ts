import type { AgentWorkspace, WorkforceAssignment } from "@lervo/agent-workforce";
import {
  observeUnstartedSupervisionWorkspace,
  readUnstartedWorkspaceSources,
  type UnstartedWorkspaceSources,
} from "./supervision-unstarted-workspace.js";

const workspaceObservationConcurrency = 4;

type BatchInput = Omit<
  Parameters<typeof observeUnstartedSupervisionWorkspace>[0],
  "assignment" | "workspace" | "sources"
> & {
  candidates: readonly { assignment: WorkforceAssignment; workspace: AgentWorkspace }[];
};

/** The proven never-used checkouts among the candidates, in input order. */
export async function observeUnstartedSupervisionWorkspaces(input: BatchInput) {
  return (await proveUnstartedSupervisionWorkspaces(input)).filter((proof) => proof !== null);
}

/** Whether every candidate checkout has a fresh proof that no worker ever used it. */
export async function allUnstartedSupervisionWorkspaces(input: BatchInput): Promise<boolean> {
  return (await proveUnstartedSupervisionWorkspaces(input)).every((proof) => proof !== null);
}

/**
 * Observes retained checkouts in bounded parallel, one proof or null per candidate in input order.
 * Each observation keeps its own freshness bound, so unbounded parallel Git inspection would let
 * many retained checkouts outlast it. With a shared store, the proofs share one read of the
 * supervision history and workspace events.
 */
async function proveUnstartedSupervisionWorkspaces(input: BatchInput) {
  const { candidates, ...shared } = input;
  let sources: Promise<UnstartedWorkspaceSources> | undefined;
  const storage = input.storage;
  const readSources =
    storage === undefined
      ? undefined
      : () => (sources ??= readUnstartedWorkspaceSources(storage, input.binding));
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
            ...(readSources === undefined ? {} : { sources: readSources }),
          });
        }
      },
    ),
  );
  return proofs;
}
