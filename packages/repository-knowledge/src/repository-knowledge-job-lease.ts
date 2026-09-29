import type { OutboxDelivery, OutboxStore } from "@lervo/storage-contract";

/** The attempt and claim times fence another generation even when it reuses the same worker ID. */
export function assertRepositoryKnowledgeJobLease(input: {
  events: OutboxStore;
  delivery: OutboxDelivery;
  now: Date;
}): void {
  const expected = input.delivery;
  const current = input.events.getOutbox(expected.event.eventId, expected.destinationId);
  const event = input.events.get(expected.event.eventId);
  const time = input.now.getTime();
  if (
    expected.lease === null ||
    current?.status !== "leased" ||
    current.lease === null ||
    event?.eventHash !== expected.event.eventHash ||
    current.event.eventHash !== expected.event.eventHash ||
    current.attemptCount !== expected.attemptCount ||
    current.lease.workerId !== expected.lease.workerId ||
    current.lease.claimedAt !== expected.lease.claimedAt ||
    current.lease.expiresAt !== expected.lease.expiresAt ||
    !Number.isFinite(time) ||
    time < Date.parse(current.lease.claimedAt) ||
    time >= Date.parse(current.lease.expiresAt)
  ) {
    throw new Error("The repository knowledge job lease generation is no longer current.");
  }
}
