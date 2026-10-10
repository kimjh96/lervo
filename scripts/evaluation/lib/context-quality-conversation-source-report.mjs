import { createHash } from "node:crypto";

const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
export const conversationSourceLimits = {
  maximumRows: 20000,
  maximumMetadataBytes: 67108864,
  maximumAcceptedBodyBytes: 65536,
};

/** Counts validated source messages, never promotes them to reviewed task families. */
export function createConversationSourceReport(projectId, integrationIds, validateEvent) {
  const allowed = new Set(integrationIds);
  const events = new Map();
  const bodyHashes = new Set();
  const pendingBodies = new Set();
  const metadata = createHash("sha256");
  const report = {
    rows: 0,
    metadataBytes: 0,
    invalidRows: 0,
    duplicateEventCopies: 0,
    normalizedHumanEvents: 0,
    verifiedHumanBodies: 0,
    unavailableHumanBodies: 0,
    bodyByteBuckets: { under40: 0, from40to199: 0, atLeast200: 0 },
  };
  let firstDate = null;
  let lastDate = null;
  return {
    observe(row, storeId) {
      const raw = JSON.stringify(row);
      report.rows++;
      report.metadataBytes += Buffer.byteLength(raw);
      if (
        report.rows > conversationSourceLimits.maximumRows ||
        report.metadataBytes > conversationSourceLimits.maximumMetadataBytes
      )
        throw new Error("Conversation source audit exceeded its metadata bound.");
      metadata.update(JSON.stringify([storeId, raw]));
      let event;
      try {
        event = JSON.parse(row.event_json);
        validateEvent(event);
        if (
          event.eventId !== row.event_id ||
          event.target.projectId !== row.project_id ||
          row.project_id !== projectId ||
          event.target.integrationId !== row.integration_id ||
          event.target.conversationId !== row.conversation_id ||
          !allowed.has(event.target.integrationId)
        )
          throw new Error("Conversation source coordinates differ.");
      } catch {
        report.invalidRows++;
        return null;
      }
      // The owner validates the canonical event ID before deduplication, independent of key order.
      if (events.has(event.eventId)) {
        report.duplicateEventCopies++;
        return null;
      }
      const human = event.actor.kind === "human";
      events.set(event.eventId, { human, reply: event.replyToEventId });
      if (!human) return null;
      report.normalizedHumanEvents++;
      pendingBodies.add(event.eventId);
      const at = new Date(event.occurredAt).toISOString();
      firstDate = firstDate === null || at < firstDate ? at : firstDate;
      lastDate = lastDate === null || at > lastDate ? at : lastDate;
      return event;
    },
    observeBody(event, bytes) {
      if (!pendingBodies.delete(event.eventId))
        throw new Error("Conversation body observation is unbound or repeated.");
      try {
        if (
          bytes === null ||
          bytes.byteLength > conversationSourceLimits.maximumAcceptedBodyBytes ||
          bytes.byteLength !== event.content.byteCount ||
          digest(bytes) !== event.content.contentHash
        )
          throw new Error("Conversation body differs from its source.");
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        report.verifiedHumanBodies++;
        bodyHashes.add(event.content.contentHash);
        const bucket =
          bytes.byteLength < 40 ? "under40" : bytes.byteLength < 200 ? "from40to199" : "atLeast200";
        report.bodyByteBuckets[bucket]++;
      } catch {
        report.unavailableHumanBodies++;
      }
    },
    finish() {
      if (pendingBodies.size) throw new Error("Conversation body observations are incomplete.");
      const replies = [...events.values()].filter((e) => e.human && e.reply !== null);
      return {
        ...structuredClone(report),
        metadataDigest: `sha256:${metadata.digest("hex")}`,
        uniqueValidatedEvents: events.size,
        uniqueHumanBodyDigests: bodyHashes.size,
        humanTimeRange: firstDate === null ? null : [firstDate, lastDate],
        humanReplyLinks: replies.length,
        humanRepliesResolvedInObservedInbox: replies.filter((e) => events.has(e.reply)).length,
        qualifiedFamilies: 0,
        reviewedLabelSets: 0,
        heldOutFamilies: 0,
        providerCalls: 0,
        privateBodiesEmitted: false,
      };
    },
  };
}
