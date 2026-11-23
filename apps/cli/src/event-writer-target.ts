import { hostedSessionEventSchemaVersion } from "@lervo/event-contract";

/**
 * The writer version repository upgrades converge on: the newest one a Lervo writer needs, the
 * ADE's hosted session events, which also carries the plan ledger's. A leaf module, so a remedy
 * can name it without loading the upgrade stages.
 */
export const TARGET_EVENT_SCHEMA_VERSION = hostedSessionEventSchemaVersion;
