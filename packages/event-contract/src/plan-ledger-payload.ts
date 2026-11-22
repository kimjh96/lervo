/** ADR-0563: every plan ledger payload field; titles and reasons are short paraphrases. */
export const planLedgerPayloadAllowlists = {
  "plan.item.captured": ["itemId", "parentId", "kind", "title", "state", "source", "occurredAt"],
  "plan.item.updated": ["itemId", "parentId", "title", "state", "occurredAt"],
  "plan.item.closed": ["itemId", "state", "reason", "evidence", "supersededBy", "occurredAt"],
  "plan.summary.gap": ["summaryDigest", "itemIds", "occurredAt"],
  "plan.turn.blocked": ["turnId", "itemIds", "attempt", "occurredAt"],
  "plan.item.missed": ["itemId", "cause", "occurredAt"],
} as const;
export const planLedgerPayloadSchemas = {
  "plan.item.captured": "planItemCapturedEventPayload",
  "plan.item.updated": "planItemUpdatedEventPayload",
  "plan.item.closed": "planItemClosedEventPayload",
  "plan.summary.gap": "planSummaryGapEventPayload",
  "plan.turn.blocked": "planTurnBlockedEventPayload",
  "plan.item.missed": "planItemMissedEventPayload",
} as const;
