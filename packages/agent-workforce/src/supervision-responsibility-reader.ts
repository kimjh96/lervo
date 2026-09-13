import type { WorkResponsibilityV1 } from "@lervo/application-contract";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import { assertWorkResponsibility, operatingContractHash } from "@lervo/work-controller";
import { assertResponsibilityMandateSuccession } from "./supervision-responsibility-mandate.js";
import {
  SupervisionEventJournal,
  type SupervisionJournalCoordinates,
} from "./supervision-event-journal.js";

export interface RecordedWorkResponsibility {
  eventId: string;
  responsibilityArtifactHash: string;
  responsibilityHash: string;
  responsibility: WorkResponsibilityV1;
}

/** Reads canonical binding history and exact CAS bytes; never installs or authorizes duties. */
export class SupervisionResponsibilityReader {
  private readonly journal: SupervisionEventJournal;
  private readonly coordinates: SupervisionJournalCoordinates;

  constructor(
    private readonly events: EventStore,
    private readonly artifacts: ArtifactStore,
    coordinates: SupervisionJournalCoordinates,
    private readonly now: () => string,
  ) {
    this.coordinates = structuredClone(coordinates);
    this.journal = new SupervisionEventJournal(events, artifacts, this.coordinates, now, null);
  }

  async current(assignmentId: string): Promise<RecordedWorkResponsibility | null> {
    if (!/^asn_[a-f0-9]{24}$/u.test(assignmentId))
      throw new Error("The responsibility assignment identity is invalid.");
    const history = () =>
      this.journal
        .history()
        .filter(
          (event) =>
            event.type === "work.responsibility.bound" &&
            event.payload.assignmentId === assignmentId,
        );
    const events = history();
    let current: RecordedWorkResponsibility | null = null;
    let workstreamRevision = 0;
    for (const event of events) {
      this.journal.assertEventBinding(event);
      const artifactHash = String(event.payload.responsibilityArtifactHash);
      const responsibility = (await this.journal.read(artifactHash)) as WorkResponsibilityV1;
      assertWorkResponsibility(responsibility);
      const revision = Number(event.payload.workstreamRevision);
      if (
        event.payload.projectId !== this.coordinates.projectId ||
        event.payload.ownerAgentId !== this.coordinates.ownerAgentId ||
        !Number.isSafeInteger(revision) ||
        revision < 1 ||
        revision < workstreamRevision ||
        revision > this.coordinates.workstreamRevision ||
        responsibility.assignmentId !== assignmentId ||
        event.payload.assignmentRevision !== responsibility.assignmentRevision ||
        event.payload.executorAgentId !== responsibility.executorAgentId ||
        event.payload.reviewerAgentId !== responsibility.reviewerAgentId ||
        event.payload.roleId !== responsibility.roleId ||
        event.payload.roleVersion !== responsibility.roleVersion ||
        event.payload.roleContractHash !== responsibility.roleContractHash ||
        event.payload.predecessorBindingHash !== responsibility.predecessorBindingHash ||
        responsibility.predecessorBindingHash !== (current?.responsibilityHash ?? null) ||
        (current !== null &&
          responsibility.assignmentRevision < current.responsibility.assignmentRevision)
      )
        throw new Error("The responsibility binding history conflicts with its exact artifacts.");
      current = {
        eventId: event.eventId,
        responsibilityArtifactHash: artifactHash,
        responsibilityHash: operatingContractHash(responsibility),
        responsibility,
      };
      workstreamRevision = revision;
    }
    if (events.at(-1)?.payload.mandateHash !== this.coordinates.mandateHash && current !== null)
      await assertResponsibilityMandateSuccession({
        events: this.events,
        artifacts: this.artifacts,
        coordinates: this.coordinates,
        binding: events.at(-1)!,
        now: this.now,
      });
    if (operatingContractHash(events) !== operatingContractHash(history()))
      throw new Error("The responsibility binding history changed during observation.");
    return current;
  }
}
