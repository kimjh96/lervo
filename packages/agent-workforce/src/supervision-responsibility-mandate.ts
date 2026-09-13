import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import { operatingContractHash } from "@lervo/work-controller";
import type { SupervisionJournalCoordinates } from "./supervision-event-journal.js";
import { SupervisionEventJournal } from "./supervision-event-journal.js";
import { SupervisionMandateJournal } from "./supervision-mandate-journal.js";

/** Historical visibility preserves the binding's mandate; current execution still needs admission. */
export async function assertResponsibilityMandateSuccession(input: {
  events: EventStore;
  artifacts: ArtifactStore;
  coordinates: SupervisionJournalCoordinates;
  binding: ReturnType<EventStore["list"]>[number];
  now(): string;
}): Promise<void> {
  const { events, artifacts, coordinates, binding, now } = input;
  const journal = new SupervisionEventJournal(events, artifacts, coordinates, now, null);
  const history = journal.history();
  const current = await new SupervisionMandateJournal(
    events,
    artifacts,
    coordinates,
    now,
    null,
  ).current();
  const installations = history.filter(
    (event) => event.type === "work.supervision.mandate.installed",
  );
  const predecessor = installations.findIndex(
    (event) => event.payload.mandateHash === binding.payload.mandateHash,
  );
  if (
    current?.mandateHash !== coordinates.mandateHash ||
    current.mandate.ownerAgentId !== coordinates.ownerAgentId ||
    predecessor < 0 ||
    predecessor >= installations.length - 1 ||
    installations[predecessor]!.seq >= binding.seq ||
    installations[predecessor + 1]!.seq <= binding.seq ||
    operatingContractHash(history) !== operatingContractHash(journal.history())
  )
    throw new Error("The responsibility has no exact reviewed mandate succession.");
}
