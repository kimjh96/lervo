export const readableEventSchemaVersions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;
/** An event schema version that every reader of this release accepts. */
export type EventSchemaVersion = (typeof readableEventSchemaVersions)[number];
/** A version a repository can activate as its writer; version 1 needs no activation. */
export type ActivatableEventSchemaVersion = Exclude<EventSchemaVersion, 1>;
export const writableEventSchemaVersion = 1 as const;
/** The writer version that carries the ADE's hosted session events (ADR-0613). */
export const hostedSessionEventSchemaVersion = 10 as const;
/** The writer version whose `resource.usage.recorded` may carry a hosted session (ADR-0632). */
export const hostedSessionUsageEventSchemaVersion = 11 as const;
/** The writer version that can record a turn no Stop hook settled (`ending` on `terminal.turn.observed`). */
export const turnEndingEventSchemaVersion = 12 as const;
/** The writer version whose `execution.stages.observed` may say how a hook's answer was delivered. */
export const hookDeliveryEventSchemaVersion = 13 as const;
/** The writer version that records a prompt answered from the cached base (ADR-0645). */
export const baseDeliveryEventSchemaVersion = 14 as const;
