import { type OutboxDelivery } from "@lervo/storage-contract";

export function partitionContiguousDeliveries(
  deliveries: readonly OutboxDelivery[],
): OutboxDelivery[][] {
  const sorted = [...deliveries].sort(
    (left, right) =>
      left.event.seq - right.event.seq || left.event.eventId.localeCompare(right.event.eventId),
  );
  const groups: OutboxDelivery[][] = [];
  for (const delivery of sorted) {
    const current = groups.at(-1);
    const previous = current?.at(-1);
    if (
      current === undefined ||
      previous === undefined ||
      delivery.event.seq !== previous.event.seq + 1 ||
      delivery.event.previousHash !== previous.event.eventHash
    ) {
      groups.push([delivery]);
    } else {
      current.push(delivery);
    }
  }
  return groups;
}
