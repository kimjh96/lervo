import { HUB_DESTINATION_ID_PATTERN, HUB_PROJECT_ID_PATTERN } from "./identifiers.js";
import { InvalidHubHttpRequestError } from "./request.js";

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export interface HubSyncHttpRoute {
  kind:
    | "registration"
    | "event-batches"
    | "workstreams"
    | "workspace-reservations"
    | "workspace-summaries"
    | "knowledge-convergence-owner"
    | "knowledge-instruction-candidates"
    | "knowledge-convergence-hosts"
    | "knowledge-convergence-definitions";
  projectId: string;
  /** ADR-0477: one definition's content hash, only on the definitions route. */
  contentHash?: string;
}

export function matchHubSyncRoute(pathname: string): HubSyncHttpRoute | null {
  const segments = pathname.split("/");
  const definitionRead =
    segments.length === 7 && segments[5] === "knowledge-convergence-definitions";
  if (
    (segments.length !== 6 && !definitionRead) ||
    segments[0] !== "" ||
    segments[1] !== "v1" ||
    segments[2] !== "sync" ||
    segments[3] !== "projects"
  )
    return null;
  let projectId: string;
  try {
    projectId = decodeURIComponent(segments[4]!);
  } catch {
    throw new InvalidHubHttpRequestError();
  }
  if (!HUB_PROJECT_ID_PATTERN.test(projectId)) throw new InvalidHubHttpRequestError();
  const kind = segments[5];
  if (
    kind !== "registration" &&
    kind !== "event-batches" &&
    kind !== "workstreams" &&
    kind !== "workspace-reservations" &&
    kind !== "workspace-summaries" &&
    kind !== "knowledge-convergence-owner" &&
    kind !== "knowledge-instruction-candidates" &&
    kind !== "knowledge-convergence-hosts" &&
    kind !== "knowledge-convergence-definitions"
  )
    return null;
  if (!definitionRead) return { kind, projectId };
  if (!HASH_PATTERN.test(segments[6]!)) throw new InvalidHubHttpRequestError();
  return { kind, projectId, contentHash: segments[6]! };
}

/**
 * ADR-0561: a workstream read may name one stored revision by its exact content hash; every other
 * route keeps the two fixed coordinates only.
 */
export function hubWorkstreamRevisionQuery(parameters: URLSearchParams): string | null {
  const values = parameters.getAll("snapshotContentHash");
  if (values.length === 0) return null;
  if (values.length !== 1 || !HASH_PATTERN.test(values[0]!)) throw new InvalidHubHttpRequestError();
  return values[0]!;
}

export function hubSyncQuery(
  parameters: URLSearchParams,
  optionalKeys: readonly string[] = [],
): {
  destinationId: string;
  projectIdentityHash: string;
} {
  const allowed = new Set(["destinationId", "projectIdentityHash", ...optionalKeys]);
  for (const key of parameters.keys()) {
    if (!allowed.has(key)) throw new InvalidHubHttpRequestError();
  }
  const destinations = parameters.getAll("destinationId");
  const identities = parameters.getAll("projectIdentityHash");
  if (
    destinations.length !== 1 ||
    identities.length !== 1 ||
    !HUB_DESTINATION_ID_PATTERN.test(destinations[0]!) ||
    !HASH_PATTERN.test(identities[0]!)
  )
    throw new InvalidHubHttpRequestError();
  return { destinationId: destinations[0]!, projectIdentityHash: identities[0]! };
}
