import { nextAssignmentLeaseGeneration } from "./assignment-lease-generation.js";
import type { WorkResponsibilityV1 } from "@lervo/application-contract";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import {
  assertWorkResponsibility,
  evaluateResponsibilityClaim,
  operatingContractHash,
} from "@lervo/work-controller";
import { claimAssignment, listAssignments } from "./store.js";
import type { WorkforceAssignment } from "./types.js";
import { SupervisionResponsibilityReader } from "./supervision-responsibility-reader.js";
import {
  SupervisionEventJournal,
  type SupervisionJournalCoordinates,
} from "./supervision-event-journal.js";
import type {
  SQLiteSupervisionOwnerLeaseStore,
  SupervisionOwnerLease,
} from "./supervision-owner-lease.js";

export interface SupervisionResponsibilityClaim {
  responsibility: WorkResponsibilityV1;
  expectedAssignmentHash: string;
  sessionId: string;
  leaseDurationMs: number;
  maximumDeadlineMs: number;
  causationEventIds: string[];
}

/** Couples one exact claim to its responsibility; the caller still supplies effect authority. */
export class SupervisionResponsibilityClaimer {
  private readonly journal: SupervisionEventJournal;
  private readonly reader: SupervisionResponsibilityReader;
  private readonly coordinates: SupervisionJournalCoordinates;
  private readonly fence: { store: SQLiteSupervisionOwnerLeaseStore; lease: SupervisionOwnerLease };

  constructor(
    private readonly repositoryRoot: string,
    private readonly events: EventStore,
    artifacts: ArtifactStore,
    coordinates: SupervisionJournalCoordinates,
    private readonly now: () => string,
    fence: { store: SQLiteSupervisionOwnerLeaseStore; lease: SupervisionOwnerLease },
  ) {
    this.coordinates = structuredClone(coordinates);
    this.fence = { store: fence.store, lease: structuredClone(fence.lease) };
    this.journal = new SupervisionEventJournal(events, artifacts, coordinates, now, fence);
    this.reader = new SupervisionResponsibilityReader(events, artifacts, coordinates, now);
  }

  async claim(
    input: SupervisionResponsibilityClaim,
    revalidate: (assignment: WorkforceAssignment) => Promise<void>,
  ) {
    input = structuredClone(input);
    const task = input.responsibility;
    assertWorkResponsibility(task);
    if (
      !/^sha256:[a-f0-9]{64}$/u.test(input.expectedAssignmentHash) ||
      input.causationEventIds.length === 0 ||
      input.causationEventIds.length > 63 ||
      new Set(input.causationEventIds).size !== input.causationEventIds.length ||
      input.causationEventIds.some(
        (id) => this.events.get(id)?.projectId !== this.coordinates.projectId,
      )
    )
      throw new Error("The responsibility claim source is invalid.");
    const requestHash = operatingContractHash(input);
    const bindingId = this.journal.eventId("work.responsibility.bound", requestHash);
    const previous = await this.reader.current(task.assignmentId);
    const before = await this.assignment(task.assignmentId);
    if (previous?.eventId === bindingId) {
      if (
        previous.responsibilityHash !== operatingContractHash(task) ||
        before.revision !== task.assignmentRevision ||
        before.assigneeAgentId !== task.executorAgentId ||
        before.lease?.sessionId !== input.sessionId
      )
        throw new Error("The recorded responsibility claim requires reconciliation.");
      return { assignment: before, responsibility: previous };
    }
    const observedAt = this.now();
    if (
      before.projectId !== this.coordinates.projectId ||
      before.workstreamId !== this.coordinates.workstreamId ||
      operatingContractHash(before) !== input.expectedAssignmentHash ||
      evaluateResponsibilityClaim({
        source: {
          ...before,
          liveLease:
            before.lease !== null && Date.parse(before.lease.expiresAt) > Date.parse(observedAt),
          predecessorBindingHash: previous?.responsibilityHash ?? null,
        },
        responsibility: task,
        maximumDeadlineMs: input.maximumDeadlineMs,
        now: observedAt,
      }).status !== "ready"
    )
      throw new Error("The responsibility claim is not ready.");
    const artifactHash = await this.journal.put(task);
    await revalidate(structuredClone(before));
    const claimTime = this.now();
    const elapsed = Date.parse(claimTime) - Date.parse(observedAt);
    if (
      !Number.isFinite(elapsed) ||
      elapsed < 0 ||
      elapsed > 5000 ||
      Date.parse(task.startDeadline) <= Date.parse(claimTime)
    )
      throw new Error("The responsibility claim observation is stale.");
    // The assignment lock remains held throughout its recorder. A rejected journal transaction
    // restores the exact previous assignment bytes through the existing claim implementation.
    const assignment = await claimAssignment({
      repositoryRoot: this.repositoryRoot,
      assignmentId: task.assignmentId,
      expectedRevision: before.revision,
      responsibilityBinding: task,
      agentId: task.executorAgentId,
      sessionId: input.sessionId,
      leaseDurationMs: input.leaseDurationMs,
      now: new Date(claimTime),
      recordEvent: async (event) => {
        const claimed = await this.assignment(task.assignmentId);
        const expected = {
          ...before,
          revision: before.revision + 1,
          assigneeAgentId: task.executorAgentId,
          status: "leased",
          lease: claimed.lease,
          lastLeaseGeneration: nextAssignmentLeaseGeneration(before),
          updatedAt: claimTime,
        };
        if (
          event.type !== "assignment.claimed" ||
          claimed.revision !== task.assignmentRevision ||
          claimed.lease?.leaseId !== event.payload.leaseId ||
          claimed.lease?.sessionId !== input.sessionId ||
          claimed.lease?.agentId !== task.executorAgentId ||
          claimed.lease?.generation !== nextAssignmentLeaseGeneration(before) ||
          claimed.lease?.generation !== event.payload.generation ||
          claimed.lease?.acquiredAt !== claimTime ||
          claimed.lease?.expiresAt !==
            new Date(Date.parse(claimTime) + input.leaseDurationMs).toISOString() ||
          claimed.lease?.expiresAt !== event.payload.expiresAt ||
          operatingContractHash(claimed) !== operatingContractHash(expected)
        )
          throw new Error("The claimed assignment differs from its exact transition.");
        await revalidate(structuredClone(claimed));
        if (
          operatingContractHash(await this.assignment(task.assignmentId)) !==
          operatingContractHash(claimed)
        )
          throw new Error("The claimed assignment changed before responsibility commit.");
        const age = Date.parse(this.now()) - Date.parse(claimTime);
        if (
          !Number.isFinite(age) ||
          age < 0 ||
          age > 5000 ||
          claimed.lease === null ||
          Date.parse(claimed.lease.expiresAt) <= Date.parse(this.now()) ||
          (await this.reader.current(task.assignmentId))?.eventId !== previous?.eventId
        )
          throw new Error("The responsibility claim authority changed.");
        const claimIdentity = `${requestHash}:${claimed.lease.leaseId}`;
        const claimDraft = this.journal.draft("assignment.claimed", event.payload, claimIdentity);
        const bindingDraft = this.journal.draft(
          "work.responsibility.bound",
          {
            schemaVersion: 1,
            projectId: this.coordinates.projectId,
            workstreamId: this.coordinates.workstreamId,
            workstreamRevision: this.coordinates.workstreamRevision,
            supervisionId: this.coordinates.supervisionId,
            ownerAgentId: this.coordinates.ownerAgentId,
            mandateHash: this.coordinates.mandateHash,
            causationEventIds: [...input.causationEventIds, claimDraft.eventId],
            assignmentId: task.assignmentId,
            assignmentRevision: task.assignmentRevision,
            executorAgentId: task.executorAgentId,
            reviewerAgentId: task.reviewerAgentId,
            roleId: task.roleId,
            roleVersion: task.roleVersion,
            roleContractHash: task.roleContractHash,
            responsibilityArtifactHash: artifactHash,
            predecessorBindingHash: task.predecessorBindingHash,
          },
          requestHash,
        );
        this.fence.store.commit(this.fence.lease, Date.parse(this.now()), () => {
          const history = this.journal.history();
          const head = history
            .filter(
              (item) =>
                item.type === "work.responsibility.bound" &&
                item.payload.assignmentId === task.assignmentId,
            )
            .at(-1);
          if (head?.eventId !== previous?.eventId || history.length + 2 > 4096)
            throw new Error("The responsibility journal head or capacity changed.");
          this.events.transact((transaction) => {
            for (const draft of [claimDraft, bindingDraft]) {
              if (transaction.append(draft).redactions.length > 0)
                throw new Error("The responsibility claim evidence was redacted.");
            }
          });
        });
      },
    });
    const recorded = await this.reader.current(task.assignmentId);
    if (recorded?.eventId !== bindingId)
      throw new Error("The responsibility claim requires recorded-effect inspection.");
    return { assignment, responsibility: recorded };
  }

  private async assignment(assignmentId: string): Promise<WorkforceAssignment> {
    const assignment = (await listAssignments(this.repositoryRoot)).find(
      (item) => item.assignmentId === assignmentId,
    );
    if (assignment === undefined) throw new Error("The responsibility assignment is unavailable.");
    return assignment;
  }
}
