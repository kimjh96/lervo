import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import {
  archiveConvergenceAssignment,
  listAssignments,
  listWorkspaces,
} from "@lervo/agent-workforce";
import { resolveRepositoryCoordinationHome, type ProjectStorage } from "@lervo/project-storage";
import { canonicalJson, sha256, stableId } from "@lervo/repository-knowledge";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

/** Keep recent projections and every live consumer; canonical events and private archives retain history. */
export async function compactConvergenceWorkforce(storage: ProjectStorage): Promise<number> {
  if ((storage.writableEventSchemaVersion ?? 1) < 4) return 0;
  const root = storage.paths.repositoryRoot;
  const assignments = await listAssignments(root);
  if (assignments.length < 256) return 0;
  const recent = new Set(
    assignments
      .toSorted(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || a.assignmentId.localeCompare(b.assignmentId),
      )
      .slice(0, 128)
      .map((item) => item.assignmentId),
  );
  const workspaces = await listWorkspaces(root);
  const home = await resolveRepositoryCoordinationHome(root, { readOnly: true });
  let count = 0;
  for (const assignment of assignments) {
    if (count >= 16) break;
    const provenance = assignment.convergence;
    if (
      !provenance ||
      recent.has(assignment.assignmentId) ||
      assignment.lease !== null ||
      !["completed", "failed", "cancelled"].includes(assignment.status) ||
      assignments.some((item) => item.dependencyIds.includes(assignment.assignmentId)) ||
      workspaces.some(
        (item) => item.assignmentId === assignment.assignmentId && item.state !== "removed",
      )
    )
      continue;
    const terminal = storage.events.get(stableId("evt", [provenance.obligationId, "terminal"], 32));
    if (
      terminal?.type !== "repository.knowledge.convergence.recorded" ||
      terminal.payload.obligationId !== provenance.obligationId
    )
      continue;
    const file = await open(
      resolve(home.workforce, "assignments", `${assignment.assignmentId}.json`),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let hash: string;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024)
        throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
      hash = sha256(await file.readFile());
    } finally {
      await file.close();
    }
    const eventId = stableId(
      "evt",
      ["convergence_assignment_archive", assignment.assignmentId, hash],
      32,
    );
    const previous = storage.events.get(eventId);
    const archivedAt = previous?.occurredAt ?? new Date().toISOString();
    await archiveConvergenceAssignment({
      repositoryRoot: root,
      assignmentId: assignment.assignmentId,
      expectedContentHash: hash,
      terminalEventId: terminal.eventId,
      terminalEventHash: terminal.eventHash,
      events: storage.events,
      artifacts: storage.artifacts,
      archivedAt,
      recordEvent: (event) => {
        storage.events.append({
          eventId,
          projectId: storage.manifest.projectId,
          runId: `run_${eventId.slice(4)}`,
          sessionId: `ses_${eventId.slice(4)}`,
          actor: { kind: "system" },
          schemaVersion: 4,
          type: event.type,
          occurredAt: event.occurredAt,
          policyVersion: sha256(canonicalJson(event.payload)),
          payload: event.payload,
        });
      },
    });
    count++;
  }
  return count;
}
