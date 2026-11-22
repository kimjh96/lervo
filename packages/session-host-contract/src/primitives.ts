// Shared building blocks of the session-host protocol (ADE session-host protocol specification).

/** An opaque identifier: workspaces, sessions, items, requests, and hosts. */
export const identifierSchema = {
  type: "string",
  pattern: "^[A-Za-z0-9_-]{1,64}$",
} as const;

/** A per-session sequence number. It only grows. */
export const sequenceSchema = { type: "integer", minimum: 1 } as const;

/** Milliseconds since the Unix epoch. */
export const epochMillisecondsSchema = { type: "integer", minimum: 0 } as const;

/** A stable code that the interface renders from its message catalog. */
export const codeSchema = {
  type: "string",
  pattern: "^[a-z][a-z0-9_]{0,63}$",
} as const;

/** Parameters of a code. Values are short scalars, never sentences for the interface to show. */
export const parametersSchema = {
  type: "object",
  maxProperties: 16,
  propertyNames: { pattern: "^[a-z][A-Za-z0-9]{0,31}$" },
  additionalProperties: {
    oneOf: [{ type: "string", maxLength: 256 }, { type: "integer" }, { type: "boolean" }],
  },
} as const;
