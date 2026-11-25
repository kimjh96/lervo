import type { FromSchema } from "json-schema-to-ts";

/**
 * What one tool call acted on and what it showed, as a tool line opens it (ADE session-host
 * protocol, "Tool detail"). The preview is bounded: the provider's transcript keeps the full input
 * and output, and a page of tool lines stays well within one frame.
 */
export const toolDetailSchema = {
  title: "ToolDetail",
  type: "object",
  additionalProperties: false,
  required: ["subject"],
  properties: {
    /** What the call acted on: a path relative to the workspace, a command, a pattern, a URL. */
    subject: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "text"],
      properties: {
        kind: { enum: ["path", "command", "pattern", "query", "url", "text"] },
        text: { type: "string", minLength: 1, maxLength: 512 },
      },
    },
    /** Counts the line shows after the subject, such as lines read or lines added and removed. */
    counts: {
      type: "object",
      additionalProperties: false,
      properties: {
        lines: { type: "integer", minimum: 0 },
        matches: { type: "integer", minimum: 0 },
        files: { type: "integer", minimum: 0 },
        added: { type: "integer", minimum: 0 },
        removed: { type: "integer", minimum: 0 },
      },
    },
    /**
     * The Lervo command a shell call ran, which the core recognizes from its own command catalog:
     * its command path without `lervo` (empty for `lervo --version` or `lervo --help`), a `help`
     * or `version` flag, and its first quoted argument, such as a search's query.
     */
    lervo: {
      type: "object",
      additionalProperties: false,
      required: ["command"],
      properties: {
        command: {
          type: "string",
          maxLength: 96,
          pattern: "^(?:[a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*){0,5})?$",
        },
        flag: { enum: ["help", "version"] },
        subject: { type: "string", minLength: 1, maxLength: 512 },
      },
    },
    /**
     * The first and last lines of the output or the change. `omittedLines` lines were left out
     * before the line at index `omittedAt`.
     */
    preview: {
      type: "object",
      additionalProperties: false,
      required: ["format", "lines", "omittedLines", "omittedAt"],
      properties: {
        format: { enum: ["output", "diff"] },
        lines: { type: "array", maxItems: 24, items: { type: "string", maxLength: 240 } },
        omittedLines: { type: "integer", minimum: 0 },
        omittedAt: { type: "integer", minimum: 0, maximum: 24 },
      },
    },
  },
} as const;

export type ToolDetail = FromSchema<typeof toolDetailSchema>;
