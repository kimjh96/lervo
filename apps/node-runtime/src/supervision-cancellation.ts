import {
  cancelAssignment,
  createAssignmentCancellationPlan,
  listAgents,
  listAssignments,
} from "@lervo/agent-workforce";
import type { OutcomeSupervisionSnapshotV1 } from "@lervo/application-contract";
import { canonicalJson } from "@lervo/event-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import { readBoundWorkstreamState } from "./supervision-workstream-state.js";
import { operatingContractHash } from "@lervo/work-controller";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import type { NodeSupervisionSession } from "./supervision-session.js";
import type { SupervisionTaskSource } from "./supervision-task-source.js";

/** Cancels one unstarted, unleased assignment against canonical user cancellation. */
export async function reconcileSupervisionCancellation(input: {
  storage: ProjectStorage;
  tasks: SupervisionTaskSource;
  binding: NodeSupervisionBinding;
  snapshot: OutcomeSupervisionSnapshotV1;
  session: Pick<NodeSupervisionSession, "readRecoveryAuthority" | "findPendingPlan" | "commit">;
  now: () => string;
}) {
  const { storage, tasks, binding, session, now } = input;
  const snapshot = structuredClone(input.snapshot);
  const source = await tasks.read();
  const authority = await session.readRecoveryAuthority();
  const combined = operatingContractHash({
    authorityDigest: authority.source.sourceRevisionDigest,
    taskDigest: source.sourceRevisionDigest,
  });
  if (
    snapshot.workstreamStatus !== "cancelled" ||
    source.workstream.status !== "cancelled" ||
    snapshot.evidenceStatus !== "valid" ||
    source.graph.validity.status !== "valid" ||
    snapshot.sourceRevisionDigest !== combined ||
    snapshot.workstreamId !== binding.workstreamId ||
    snapshot.supervisionId !== binding.supervisionId ||
    snapshot.ownerAgentId !== binding.ownerAgentId ||
    snapshot.mandateHash !== binding.mandateHash ||
    snapshot.projectId !== storage.manifest.projectId ||
    snapshot.workstreamRevision !== source.workstream.revision ||
    (await session.findPendingPlan()) !== null
  )
    throw new Error("Cancellation reconciliation differs from its canonical source.");
  const assignment = source.assignments.find(
    (item) =>
      ["queued", "blocked"].includes(item.status) &&
      item.revision === 1 &&
      item.lease === null &&
      !source.execution.attempts.some((attempt) => attempt.assignmentId === item.assignmentId) &&
      !source.events.some(
        (event) =>
          event.payload.assignmentId === item.assignmentId &&
          ["assignment.claimed", "work.responsibility.bound", "work.causality.recorded"].includes(
            event.type,
          ),
      ),
  );
  if (assignment === undefined) return null;
  const plan = createAssignmentCancellationPlan({
    assignments: source.allAssignments,
    assignmentId: assignment.assignmentId,
    reason: "requested",
  });
  if (plan.status !== "ready") return null;
  const proof = await storage.artifacts.put(
    canonicalJson({
      schemaVersion: 1,
      kind: "work.supervision.cancellation",
      ...binding,
      projectId: storage.manifest.projectId,
      sourceRevisionDigest: combined,
      workstreamSnapshotHash: source.workstreamHash,
      causationEventIds: [source.sourceEventId],
      assignmentHash: operatingContractHash(assignment),
      cancellationPlan: plan,
    }),
  );
  const identity = proof.contentHash.slice(7, 39);
  const eventId = `evt_${identity}`;
  await cancelAssignment({
    repositoryRoot: storage.paths.repositoryRoot,
    assignmentId: assignment.assignmentId,
    expectedPlanId: plan.planId,
    reason: "requested",
    now: new Date(now()),
    beforeWrite: async () => {
      const current = await session.readRecoveryAuthority();
      if (
        current.source.sourceRevisionDigest !== authority.source.sourceRevisionDigest ||
        current.installation.latestEventId !== authority.installation.latestEventId ||
        (await tasks.read()).sourceRevisionDigest !== source.sourceRevisionDigest ||
        (await session.findPendingPlan()) !== null
      )
        throw new Error("Cancellation authority changed before assignment mutation.");
      session.commit(() => undefined);
    },
    recordEvent: async (event) => {
      const current = await session.readRecoveryAuthority();
      const workstream = await readBoundWorkstreamState(storage, binding.workstreamId);
      const agents = await listAgents(storage.paths.repositoryRoot);
      const assignments = await listAssignments(storage.paths.repositoryRoot);
      const expectedAssignments = source.allAssignments.map((item) =>
        item.assignmentId !== assignment.assignmentId
          ? item
          : {
              ...item,
              status: "cancelled",
              lease: null,
              revision: item.revision + 1,
              updatedAt: event.occurredAt,
            },
      );
      session.commit(() => {
        const age = Date.parse(now()) - Date.parse(current.observedAt);
        if (
          !Number.isFinite(age) ||
          age < 0 ||
          age > 5000 ||
          current.source.sourceRevisionDigest !== authority.source.sourceRevisionDigest ||
          current.installation.latestEventId !== authority.installation.latestEventId ||
          workstream?.contentHash !== source.workstreamHash ||
          operatingContractHash(agents) !== operatingContractHash(source.agents) ||
          operatingContractHash(assignments) !== operatingContractHash(expectedAssignments) ||
          storage.events.latest()?.eventHash !== source.events.at(-1)?.eventHash
        )
          throw new Error("Cancellation source changed at its event commit.");
        storage.events.append({
          eventId,
          projectId: storage.manifest.projectId,
          runId: `run_${identity}`,
          sessionId: `ses_${operatingContractHash(binding).slice(7, 39)}`,
          type: event.type,
          schemaVersion: 3,
          occurredAt: event.occurredAt,
          actor: { kind: "system" },
          policyVersion: proof.contentHash,
          payload: event.payload,
        });
      });
    },
  });
  return { eventIds: [eventId] };
}
