import { hostedSessionUsageEventSchemaVersion } from "@lervo/event-contract";

/**
 * The writer version repository upgrades converge on: the newest one a Lervo writer needs, the
 * hosted session usage records of `resource.usage.recorded`, which also carries the hosted
 * session and plan ledger events. A leaf module, so a remedy can name it without loading the
 * upgrade stages.
 */
export const TARGET_EVENT_SCHEMA_VERSION = hostedSessionUsageEventSchemaVersion;
