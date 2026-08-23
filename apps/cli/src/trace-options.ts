import { parseArgs } from "node:util";

import {
  defaultTracePageSize,
  maximumTracePageSize,
} from "@lervo/diagnostics";
import { eventTypes, type EventType } from "@lervo/schemas";

export const traceUsage = `  lervo trace [last|run-id] [--root <path>] [--json] [--page-size <1-${maximumTracePageSize}>] [--event-type <type>...] [--full]
  lervo trace --cursor <cursor> [--root <path>] [--json]
  lervo trace --deliberation <deliberation-id> [--root <path>] [--json]
  lervo trace --capabilities [--json]
  The default output is a bounded page of at most ${defaultTracePageSize} events; request the complete v1 report with --full.`;

const knownEventTypes = new Set<string>(eventTypes);

export type TraceCommandRequest =
  | { kind: "capabilities" }
  | { kind: "cursor"; cursor: string }
  | { kind: "deliberation"; deliberationId: string }
  | { kind: "first_page"; selector: string; limit?: number; eventTypes?: EventType[] }
  | { kind: "full"; selector: string };

export type TraceCommandOptions =
  | { help: true }
  | { help: false; root?: string; json: boolean; request: TraceCommandRequest };

function parsePageSize(value: string): number {
  if (!/^\d+$/.test(value)) throw new RangeError("page-size must be an integer.");
  const pageSize = Number(value);
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > maximumTracePageSize) {
    throw new RangeError(`page-size must be between 1 and ${maximumTracePageSize}.`);
  }
  return pageSize;
}

export function parseTraceCommandOptions(args: string[]): TraceCommandOptions {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      root: { type: "string" },
      json: { type: "boolean" },
      "page-size": { type: "string" },
      cursor: { type: "string" },
      full: { type: "boolean" },
      capabilities: { type: "boolean" },
      deliberation: { type: "string" },
      "event-type": { type: "string", multiple: true },
      help: { type: "boolean", short: "h" },
    },
  });
  if (parsed.values.help) return { help: true };
  if (parsed.positionals.length > 1) {
    throw new TypeError("Only one run ID may be specified.");
  }
  const requestedEventTypes = parsed.values["event-type"];
  if (parsed.values.capabilities === true && (
    parsed.positionals.length > 0 ||
    parsed.values.root !== undefined ||
    parsed.values.cursor !== undefined ||
    parsed.values.deliberation !== undefined ||
    parsed.values.full === true ||
    parsed.values["page-size"] !== undefined ||
    requestedEventTypes !== undefined
  )) {
    throw new TypeError(
      "capabilities cannot be combined with run ID, root, cursor, deliberation, full, page-size, or event-type.",
    );
  }
  if (parsed.values.cursor !== undefined && (
    parsed.positionals.length > 0 ||
    parsed.values.full === true ||
    parsed.values["page-size"] !== undefined ||
    requestedEventTypes !== undefined || parsed.values.deliberation !== undefined
  )) {
    throw new TypeError("cursor cannot be combined with run ID, full, page-size, event-type, or deliberation.");
  }
  if (parsed.values.deliberation !== undefined && (
    parsed.positionals.length > 0 || parsed.values.full === true ||
    parsed.values["page-size"] !== undefined || requestedEventTypes !== undefined
  )) {
    throw new TypeError("deliberation cannot be combined with run ID, full, page-size, or event-type.");
  }
  if (requestedEventTypes !== undefined && (
    new Set(requestedEventTypes).size !== requestedEventTypes.length ||
    requestedEventTypes.some((eventType) => !knownEventTypes.has(eventType))
  )) {
    throw new TypeError("event-type values must be supported and unique.");
  }

  const common = {
    help: false as const,
    json: parsed.values.json ?? false,
    ...(parsed.values.root === undefined ? {} : { root: parsed.values.root }),
  };
  if (parsed.values.capabilities === true) {
    return { ...common, request: { kind: "capabilities" } };
  }
  if (parsed.values.cursor !== undefined) {
    return { ...common, request: { kind: "cursor", cursor: parsed.values.cursor } };
  }
  if (parsed.values.deliberation !== undefined) {
    if (!/^dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(parsed.values.deliberation)) {
      throw new TypeError("The deliberation ID is invalid.");
    }
    return {
      ...common,
      request: { kind: "deliberation", deliberationId: parsed.values.deliberation },
    };
  }
  const selector = parsed.positionals[0] ?? "last";
  const paged = parsed.values["page-size"] !== undefined || requestedEventTypes !== undefined;
  if (parsed.values.full === true && paged) {
    throw new TypeError("full cannot be combined with page-size or event-type.");
  }
  if (parsed.values.full === true) {
    return {
      ...common,
      request: { kind: "full", selector },
    };
  }
  return {
    ...common,
    request: {
      kind: "first_page",
      selector,
      ...(parsed.values["page-size"] === undefined
        ? {}
        : { limit: parsePageSize(parsed.values["page-size"]) }),
      ...(requestedEventTypes === undefined
        ? {}
        : { eventTypes: requestedEventTypes as EventType[] }),
    },
  };
}
