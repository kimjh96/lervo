import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { OutboxStore, ArtifactStore } from "@lervo/storage-contract";
import { readAssignmentState, assignmentPath, listAssignments } from "./assignment-state.js";
import { listWorkspaces } from "./workspace-store.js";
import { acquireLock } from "./workforce-state-io.js";
import { fail } from "./workforce-state-validation.js";
import type { WorkforceEvent } from "./types.js";

/** Archive only a terminal convergence projection after canonical proof and all consumers close. */
export async function archiveConvergenceAssignment(input: {
  repositoryRoot: string;
  assignmentId: string;
  expectedContentHash: string;
  terminalEventId: string;
  terminalEventHash: string;
  events: Pick<OutboxStore, "get">;
  artifacts: ArtifactStore;
  archivedAt: string;
  recordEvent: (
    event: Omit<WorkforceEvent, "type"> & { type: "assignment.convergence.archived" },
  ) => void | Promise<void>;
}): Promise<void> {
  const target = await assignmentPath(input.repositoryRoot, input.assignmentId);
  const release = await acquireLock(target.lockPath, new Date());
  try {
    const stored = await readAssignmentState(input.repositoryRoot, input.assignmentId);
    const assignment = stored.value;
    const hash = `sha256:${createHash("sha256").update(stored.source).digest("hex")}`;
    const terminal = input.events.get(input.terminalEventId);
    const consumers = await listAssignments(input.repositoryRoot);
    const workspaces = await listWorkspaces(input.repositoryRoot);
    if (
      !Number.isFinite(Date.parse(input.archivedAt)) ||
      hash !== input.expectedContentHash ||
      assignment.convergence == null ||
      assignment.lease !== null ||
      !["completed", "failed", "cancelled"].includes(assignment.status) ||
      terminal?.type !== "repository.knowledge.convergence.recorded" ||
      terminal.eventHash !== input.terminalEventHash ||
      terminal.projectId !== assignment.projectId ||
      terminal.payload.obligationId !== assignment.convergence.obligationId ||
      consumers.some(
        (item) =>
          item.assignmentId !== assignment.assignmentId &&
          item.dependencyIds.includes(assignment.assignmentId),
      ) ||
      workspaces.some(
        (item) => item.assignmentId === assignment.assignmentId && item.state !== "removed",
      )
    )
      fail(
        "assignment_lease_conflict",
        "Archival requires exact terminal evidence and closed consumers.",
      );
    const artifact = await input.artifacts.put(stored.source);
    if (artifact.contentHash !== hash)
      fail("workforce_write_failed", "The assignment archive bytes differ.");
    await input.recordEvent({
      type: "assignment.convergence.archived",
      occurredAt: input.archivedAt,
      actorAgentId: null,
      payload: {
        assignmentId: assignment.assignmentId,
        assignmentRevision: assignment.revision,
        assignmentHash: hash,
        obligationId: assignment.convergence.obligationId,
        terminalEventId: input.terminalEventId,
        terminalEventHash: input.terminalEventHash,
        terminalStatus: assignment.status,
        archiveArtifactHash: artifact.contentHash,
        archivedAt: input.archivedAt,
      },
    });
    await rm(target.path);
  } finally {
    await release();
  }
}
