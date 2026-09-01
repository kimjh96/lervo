import { type IncomingMessage } from "node:http";

import {
  type HubKnowledgeGraphQuery,
  type HubProjectRunQuery,
  type HubProjectTraceQuery,
  type HubRunEventQuery,
  type HubWorkTraceQuery,
} from "@lervo/hub-trace";
import {
  assertKnowledgeGraphNode,
  knowledgeGraphNodeKinds,
  type KnowledgeGraphNodeKind,
} from "@lervo/knowledge-graph";

import {
  decodeEventCursor,
  decodeKnowledgeGraphCursor,
  decodeProjectCursor,
  decodeRunCursor,
} from "./cursor.js";
import {
  HUB_DESTINATION_ID_PATTERN,
  HUB_PROJECT_ID_PATTERN,
  HUB_RUN_ID_PATTERN,
  HUB_WORK_ID_PATTERN,
} from "./identifiers.js";

export type HubTraceHttpRoute =
  | { kind: "projects" }
  | { kind: "project"; encodedProjectId: string }
  | { kind: "graph"; encodedProjectId: string }
  | { kind: "work"; encodedProjectId: string; encodedWorkId: string }
  | { kind: "run"; encodedProjectId: string; encodedRunId: string };

export class InvalidHubHttpRequestError extends Error {}

export function matchHubTraceRoute(pathname: string): HubTraceHttpRoute | null {
  const segments = pathname.split("/");
  if (
    segments[0] !== "" ||
    segments[1] !== "v1" ||
    segments[2] !== "trace" ||
    segments[3] !== "projects"
  ) {
    return null;
  }
  if (segments.length === 4) return { kind: "projects" };
  if (segments.length === 5 && segments[4] !== "") {
    return { kind: "project", encodedProjectId: segments[4]! };
  }
  if (segments.length === 6 && segments[4] !== "" && segments[5] === "graph") {
    return { kind: "graph", encodedProjectId: segments[4]! };
  }
  if (segments.length === 7 && segments[4] !== "" && segments[5] === "runs" && segments[6] !== "") {
    return {
      kind: "run",
      encodedProjectId: segments[4]!,
      encodedRunId: segments[6]!,
    };
  }
  if (
    segments.length === 7 &&
    segments[4] !== "" &&
    segments[5] === "works" &&
    segments[6] !== ""
  ) {
    return {
      kind: "work",
      encodedProjectId: segments[4]!,
      encodedWorkId: segments[6]!,
    };
  }
  return null;
}

export function singleAuthorizationHeader(request: IncomingMessage): string | undefined {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === "authorization") {
      values.push(request.rawHeaders[index + 1] ?? "");
    }
  }
  return values.length === 1 ? values[0] : undefined;
}

export function assertEmptyHubRequestBody(request: IncomingMessage): void {
  const contentLength = request.headers["content-length"];
  if (
    request.headers["transfer-encoding"] !== undefined ||
    (contentLength !== undefined && contentLength !== "0")
  ) {
    throw new InvalidHubHttpRequestError();
  }
}

function singleQueryValue(
  parameters: URLSearchParams,
  name: string,
  required = false,
): string | undefined {
  const values = parameters.getAll(name);
  if (values.length > 1 || (required && values.length !== 1) || values[0] === "") {
    throw new InvalidHubHttpRequestError();
  }
  return values[0];
}

function assertQueryKeys(parameters: URLSearchParams, allowed: readonly string[]): void {
  const accepted = new Set(allowed);
  for (const key of parameters.keys()) {
    if (!accepted.has(key)) throw new InvalidHubHttpRequestError();
  }
}

function limit(parameters: URLSearchParams): number | undefined {
  const value = singleQueryValue(parameters, "limit");
  if (value === undefined) return undefined;
  if (!/^[1-9][0-9]*$/.test(value)) throw new InvalidHubHttpRequestError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new InvalidHubHttpRequestError();
  return parsed;
}

function decodedId(value: string, pattern: RegExp): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new InvalidHubHttpRequestError();
  }
  if (!pattern.test(decoded)) throw new InvalidHubHttpRequestError();
  return decoded;
}

function destinationId(parameters: URLSearchParams): string {
  const value = singleQueryValue(parameters, "destinationId", true)!;
  if (!HUB_DESTINATION_ID_PATTERN.test(value)) throw new InvalidHubHttpRequestError();
  return value;
}

function decodedCursor<T>(
  value: string | undefined,
  decoder: (cursor: string) => T,
): T | undefined {
  if (value === undefined) return undefined;
  try {
    return decoder(value);
  } catch {
    throw new InvalidHubHttpRequestError();
  }
}

export function projectListQuery(parameters: URLSearchParams): HubProjectTraceQuery {
  assertQueryKeys(parameters, ["limit", "cursor"]);
  const requestedLimit = limit(parameters);
  const after = decodedCursor(singleQueryValue(parameters, "cursor"), decodeProjectCursor);
  return {
    ...(requestedLimit === undefined ? {} : { limit: requestedLimit }),
    ...(after === undefined ? {} : { after }),
  };
}

function projectCoordinate(
  route: Exclude<HubTraceHttpRoute, { kind: "projects" }>,
  parameters: URLSearchParams,
) {
  return {
    destinationId: destinationId(parameters),
    projectId: decodedId(route.encodedProjectId, HUB_PROJECT_ID_PATTERN),
  };
}

export function projectRunQuery(
  route: Extract<HubTraceHttpRoute, { kind: "project" }>,
  parameters: URLSearchParams,
): HubProjectRunQuery {
  assertQueryKeys(parameters, ["destinationId", "limit", "cursor"]);
  const requestedLimit = limit(parameters);
  const after = decodedCursor(singleQueryValue(parameters, "cursor"), decodeRunCursor);
  return {
    ...projectCoordinate(route, parameters),
    ...(requestedLimit === undefined ? {} : { limit: requestedLimit }),
    ...(after === undefined ? {} : { after }),
  };
}

export function runEventQuery(
  route: Extract<HubTraceHttpRoute, { kind: "run" }>,
  parameters: URLSearchParams,
): HubRunEventQuery {
  assertQueryKeys(parameters, ["destinationId", "limit", "cursor"]);
  const requestedLimit = limit(parameters);
  const after = decodedCursor(singleQueryValue(parameters, "cursor"), decodeEventCursor);
  return {
    ...projectCoordinate(route, parameters),
    runId: decodedId(route.encodedRunId, HUB_RUN_ID_PATTERN),
    ...(requestedLimit === undefined ? {} : { limit: requestedLimit }),
    ...(after === undefined ? {} : { after }),
  };
}

export function workTraceQuery(
  route: Extract<HubTraceHttpRoute, { kind: "work" }>,
  parameters: URLSearchParams,
): HubWorkTraceQuery {
  assertQueryKeys(parameters, ["destinationId"]);
  return {
    ...projectCoordinate(route, parameters),
    workId: decodedId(route.encodedWorkId, HUB_WORK_ID_PATTERN),
  };
}

export function knowledgeGraphQuery(
  route: Extract<HubTraceHttpRoute, { kind: "graph" }>,
  parameters: URLSearchParams,
): HubKnowledgeGraphQuery {
  assertQueryKeys(parameters, ["destinationId", "focusKind", "focusId", "limit", "cursor"]);
  const coordinate = projectCoordinate(route, parameters);
  const requestedKind = singleQueryValue(parameters, "focusKind");
  const requestedId = singleQueryValue(parameters, "focusId");
  if ((requestedKind === undefined) !== (requestedId === undefined)) {
    throw new InvalidHubHttpRequestError();
  }
  const focus =
    requestedKind === undefined
      ? { kind: "project" as const, id: coordinate.projectId }
      : { kind: requestedKind as KnowledgeGraphNodeKind, id: requestedId! };
  if (!knowledgeGraphNodeKinds.includes(focus.kind)) throw new InvalidHubHttpRequestError();
  try {
    assertKnowledgeGraphNode(focus);
  } catch {
    throw new InvalidHubHttpRequestError();
  }
  const requestedLimit = limit(parameters);
  const after = decodedCursor(singleQueryValue(parameters, "cursor"), decodeKnowledgeGraphCursor);
  return {
    ...coordinate,
    focus,
    ...(requestedLimit === undefined ? {} : { limit: requestedLimit }),
    ...(after === undefined ? {} : { after }),
  };
}
