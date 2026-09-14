import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import { readAssignment } from "./assignment-state.js";
import { renewAssignmentLease } from "./assignment-lease.js";
import {
  SupervisionEventJournal,
  type SupervisionJournalCoordinates,
} from "./supervision-event-journal.js";
import type {
  SQLiteSupervisionOwnerLeaseStore,
  SupervisionOwnerLease,
} from "./supervision-owner-lease.js";
import type { WorkforceAssignment } from "./types.js";

/** Renew only when the exact lease would otherwise expire within this window. */
export const WORKER_LEASE_RENEWAL_WINDOW_MS = 120_000;

/**
 * Extends the executor's exact live lease while its managed run is still observed. The renewal
 * records `assignment.lease.renewed` under the owner fence; it never claims, reassigns, or
 * resurrects an expired lease, and a far-from-expiry lease is left untouched.
 */
export async function renewSupervisedWorkerLease(input: {
  repositoryRoot: string;
  events: EventStore;
  artifacts: ArtifactStore;
  coordinates: SupervisionJournalCoordinates;
  now(): string;
  fence: { store: SQLiteSupervisionOwnerLeaseStore; lease: SupervisionOwnerLease };
  assignmentId: string;
  agentId: string;
  leaseId: string;
  leaseDurationMs: number;
}): Promise<WorkforceAssignment | null> {
  const nowMs = Date.parse(input.now());
  const current = await readAssignment(input.repositoryRoot, input.assignmentId);
  if (
    current.status !== "leased" ||
    current.lease === null ||
    current.lease.leaseId !== input.leaseId ||
    current.lease.agentId !== input.agentId ||
    Date.parse(current.lease.expiresAt) <= nowMs
  )
    throw new Error("The worker lease is not the exact live lease of this run.");
  if (Date.parse(current.lease.expiresAt) - nowMs > WORKER_LEASE_RENEWAL_WINDOW_MS) return null;
  const journal = new SupervisionEventJournal(
    input.events,
    input.artifacts,
    input.coordinates,
    input.now,
    input.fence,
  );
  return renewAssignmentLease({
    repositoryRoot: input.repositoryRoot,
    assignmentId: input.assignmentId,
    agentId: input.agentId,
    leaseId: input.leaseId,
    leaseDurationMs: input.leaseDurationMs,
    now: new Date(nowMs),
    recordEvent: async (event) => {
      if (event.type !== "assignment.lease.renewed")
        throw new Error("The worker lease renewal produced an unexpected event.");
      const draft = journal.draft(
        event.type,
        event.payload,
        `${input.leaseId}:${String(event.payload.expiresAt)}`,
      );
      input.fence.store.commit(input.fence.lease, Date.parse(input.now()), () => {
        input.events.transact((transaction) => {
          if (transaction.append(draft).redactions.length > 0)
            throw new Error("The worker lease renewal event was redacted.");
        });
      });
    },
  });
}
