import {
  createWorkstreamUpdatePlan,
  readCurrentWorkstream,
  type WorkstreamUpdatePlan,
} from "./workstream.js";
import type { WorkstreamBookkeeping } from "./workstream-bookkeeping.js";
import { deriveWorkstreamRevision, type WorkstreamChange } from "./workstream-revision.js";

export interface WorkstreamRevisionPlan extends WorkstreamUpdatePlan {
  droppedNotesThisRevision: number;
  bookkeeping: WorkstreamBookkeeping;
}

/**
 * Plans an authored update: the service derives the next revision from the verified current
 * snapshot, then the exact update planner binds it. The plan ID binds the current snapshot hash and
 * the semantic intent, so a later invocation with a newer clock or HEAD observation reproduces it.
 */
export async function createWorkstreamRevisionPlan(input: {
  repositoryRoot: string;
  projectId: string;
  change: WorkstreamChange;
  bookkeeping: WorkstreamBookkeeping;
}): Promise<WorkstreamRevisionPlan> {
  // An invalid projection derives nothing; the update planner reports it as missing or invalid.
  const current = await readCurrentWorkstream(input.repositoryRoot).catch(() => null);
  const derivation =
    current === null
      ? { snapshot: null, droppedNotesThisRevision: 0, blockers: [] }
      : deriveWorkstreamRevision({
          current,
          change: input.change,
          bookkeeping: input.bookkeeping,
        });
  const plan = await createWorkstreamUpdatePlan({
    repositoryRoot: input.repositoryRoot,
    projectId: input.projectId,
    snapshot: derivation.snapshot,
  });
  const blockers = [
    ...derivation.blockers,
    ...plan.blockers.filter(
      (blocker) =>
        derivation.snapshot !== null ||
        blocker.code !== "invalid_snapshot" ||
        derivation.blockers.length === 0,
    ),
  ];
  return {
    ...plan,
    status: blockers.length === 0 ? "ready" : "blocked",
    blockers,
    operations: blockers.length === 0 ? plan.operations : [],
    droppedNotesThisRevision: derivation.droppedNotesThisRevision,
    bookkeeping: input.bookkeeping,
  };
}
