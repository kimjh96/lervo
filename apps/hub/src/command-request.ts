import {
  HUB_DESTINATION_ID_PATTERN,
  HUB_PROJECT_ID_PATTERN,
} from "./identifiers.js";
import { InvalidHubHttpRequestError } from "./request.js";

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const NODE_ID_PATTERN = /^node_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;

export type HubRemoteCommandHttpRoute = {
  kind: "leases" | "acknowledgements";
  projectId: string;
};

export interface HubRemoteCommandQuery {
  destinationId: string;
  projectIdentityHash: string;
  nodeId: string;
}

export function matchHubRemoteCommandRoute(pathname: string): HubRemoteCommandHttpRoute | null {
  const segments = pathname.split("/");
  if (
    segments.length !== 6 || segments[0] !== "" || segments[1] !== "v1" ||
    segments[2] !== "commands" || segments[3] !== "projects"
  ) return null;
  let projectId: string;
  try {
    projectId = decodeURIComponent(segments[4]!);
  } catch {
    throw new InvalidHubHttpRequestError();
  }
  if (!HUB_PROJECT_ID_PATTERN.test(projectId)) throw new InvalidHubHttpRequestError();
  const kind = segments[5];
  if (kind !== "leases" && kind !== "acknowledgements") return null;
  return { kind, projectId };
}

function one(parameters: URLSearchParams, name: string): string {
  const values = parameters.getAll(name);
  if (values.length !== 1 || values[0] === "") throw new InvalidHubHttpRequestError();
  return values[0]!;
}

export function remoteCommandQuery(parameters: URLSearchParams): HubRemoteCommandQuery {
  const allowed = new Set(["destinationId", "projectIdentityHash", "nodeId"]);
  for (const key of parameters.keys()) {
    if (!allowed.has(key)) throw new InvalidHubHttpRequestError();
  }
  const destinationId = one(parameters, "destinationId");
  const projectIdentityHash = one(parameters, "projectIdentityHash");
  const nodeId = one(parameters, "nodeId");
  if (
    !HUB_DESTINATION_ID_PATTERN.test(destinationId) ||
    !HASH_PATTERN.test(projectIdentityHash) ||
    !NODE_ID_PATTERN.test(nodeId)
  ) throw new InvalidHubHttpRequestError();
  return { destinationId, projectIdentityHash, nodeId };
}

export function remoteCommandLeaseBody(value: unknown): {
  leaseDurationMs: number;
  limit: number;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidHubHttpRequestError();
  }
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).length !== 3 || body.schemaVersion !== 1 ||
    !Number.isSafeInteger(body.leaseDurationMs) ||
    (body.leaseDurationMs as number) < 1_000 ||
    (body.leaseDurationMs as number) > 5 * 60_000 ||
    !Number.isSafeInteger(body.limit) ||
    (body.limit as number) < 1 || (body.limit as number) > 16
  ) throw new InvalidHubHttpRequestError();
  return {
    leaseDurationMs: body.leaseDurationMs as number,
    limit: body.limit as number,
  };
}
