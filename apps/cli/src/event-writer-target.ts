import { hookDeliveryEventSchemaVersion } from "@lervo/event-contract";

/**
 * The writer version repository upgrades converge on: the newest one a Lervo writer needs, the
 * `delivery` of a terminal hook's `execution.stages.observed`, which also carries the turn ending
 * of `terminal.turn.observed`, the hosted session usage records, and the hosted session and plan
 * ledger events. A leaf module, so a remedy can name it without loading the upgrade stages.
 */
export const TARGET_EVENT_SCHEMA_VERSION = hookDeliveryEventSchemaVersion;
