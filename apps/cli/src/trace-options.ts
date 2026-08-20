import { parseArgs } from "node:util";

import { maximumTracePageSize } from "@lervo/diagnostics";
import { eventTypes, type EventType } from "@lervo/schemas";

export const traceUsage =
  `  lervo trace [last|run-id] [--root <path>] [--json] [--page-size <1-${maximumTracePageSize}>] [--event-type <type>...] | --cursor <cursor>`;

const knownEventTypes = new Set<string>(eventTypes);

export type TraceCommandRequest =
  | { kind: "cursor"; cursor: string }
  | { kind: "first_page"; selector: string; limit?: number; eventTypes?: EventType[] }
  | { kind: "full"; selector: string };

export type TraceCommandOptions =
  | { help: true }
  | { help: false; root?: string; json: boolean; request: TraceCommandRequest };

function parsePageSize(value: string): number {
  if (!/^\d+$/.test(value)) throw new RangeError("page-size는 정수여야 합니다.");
  const pageSize = Number(value);
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > maximumTracePageSize) {
    throw new RangeError(`page-size는 1 이상 ${maximumTracePageSize} 이하여야 합니다.`);
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
      "event-type": { type: "string", multiple: true },
      help: { type: "boolean", short: "h" },
    },
  });
  if (parsed.values.help) return { help: true };
  if (parsed.positionals.length > 1) {
    throw new TypeError("run ID는 하나만 지정할 수 있습니다.");
  }
  const requestedEventTypes = parsed.values["event-type"];
  if (parsed.values.cursor !== undefined && (
    parsed.positionals.length > 0 ||
    parsed.values["page-size"] !== undefined ||
    requestedEventTypes !== undefined
  )) {
    throw new TypeError("cursor는 run ID, page-size, event-type과 함께 지정할 수 없습니다.");
  }
  if (requestedEventTypes !== undefined && (
    new Set(requestedEventTypes).size !== requestedEventTypes.length ||
    requestedEventTypes.some((eventType) => !knownEventTypes.has(eventType))
  )) {
    throw new TypeError("event-type은 지원하는 값을 중복 없이 지정해야 합니다.");
  }

  const common = {
    help: false as const,
    json: parsed.values.json ?? false,
    ...(parsed.values.root === undefined ? {} : { root: parsed.values.root }),
  };
  if (parsed.values.cursor !== undefined) {
    return { ...common, request: { kind: "cursor", cursor: parsed.values.cursor } };
  }
  const selector = parsed.positionals[0] ?? "last";
  const paged = parsed.values["page-size"] !== undefined || requestedEventTypes !== undefined;
  if (!paged) return { ...common, request: { kind: "full", selector } };
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
