import {
  HUB_DESTINATION_ID_PATTERN,
  HUB_PROJECT_ID_PATTERN,
} from "./identifiers.js";
import { InvalidHubHttpRequestError } from "./request.js";

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export interface HubSyncHttpRoute {
  kind: "registration" | "event-batches" | "workstreams";
  projectId: string;
}

export function matchHubSyncRoute(pathname: string): HubSyncHttpRoute | null {
  const segments = pathname.split("/");
  if (
    segments.length !== 6 || segments[0] !== "" || segments[1] !== "v1" ||
    segments[2] !== "sync" || segments[3] !== "projects"
  ) return null;
  let projectId: string;
  try {
    projectId = decodeURIComponent(segments[4]!);
  } catch {
    throw new InvalidHubHttpRequestError();
  }
  if (!HUB_PROJECT_ID_PATTERN.test(projectId)) throw new InvalidHubHttpRequestError();
  const kind = segments[5];
  if (kind !== "registration" && kind !== "event-batches" && kind !== "workstreams") return null;
  return { kind, projectId };
}

export function hubSyncQuery(parameters: URLSearchParams): {
  destinationId: string;
  projectIdentityHash: string;
} {
  const allowed = new Set(["destinationId", "projectIdentityHash"]);
  for (const key of parameters.keys()) {
    if (!allowed.has(key)) throw new InvalidHubHttpRequestError();
  }
  const destinations = parameters.getAll("destinationId");
  const identities = parameters.getAll("projectIdentityHash");
  if (
    destinations.length !== 1 || identities.length !== 1 ||
    !HUB_DESTINATION_ID_PATTERN.test(destinations[0]!) ||
    !HASH_PATTERN.test(identities[0]!)
  ) throw new InvalidHubHttpRequestError();
  return { destinationId: destinations[0]!, projectIdentityHash: identities[0]! };
}
