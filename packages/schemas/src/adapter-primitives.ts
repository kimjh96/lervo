export const adapterIdSchema = {
  type: "string",
  pattern: "^[a-z][a-z0-9_-]*(/[a-z][a-z0-9_-]*)?$",
} as const;

export const capabilitySupportSchema = {
  type: "string",
  enum: ["supported", "unsupported", "unknown"],
} as const;

export const adapterExecutionModeSchema = {
  type: "string",
  enum: ["read_only", "managed_write"],
} as const;

export const capabilityMatrixSchema = {
  type: "object",
  properties: {
    controlledContextInjection: capabilitySupportSchema,
    toolCalls: capabilitySupportSchema,
    commandExecution: capabilitySupportSchema,
    fileChanges: capabilitySupportSchema,
    contextCompaction: capabilitySupportSchema,
    sessionResume: capabilitySupportSchema,
    usage: capabilitySupportSchema,
  },
  required: [
    "controlledContextInjection",
    "toolCalls",
    "commandExecution",
    "fileChanges",
    "contextCompaction",
    "sessionResume",
    "usage",
  ],
  additionalProperties: false,
} as const;
