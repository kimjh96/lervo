export const readableEventSchemaVersions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
/** An event schema version that every reader of this release accepts. */
export type EventSchemaVersion = (typeof readableEventSchemaVersions)[number];
/** A version a repository can activate as its writer; version 1 needs no activation. */
export type ActivatableEventSchemaVersion = Exclude<EventSchemaVersion, 1>;
export const writableEventSchemaVersion = 1 as const;
/** The writer version that carries the ADE's hosted session events (ADR-0613). */
export const hostedSessionEventSchemaVersion = 10 as const;
