import type { IncomingMessage } from "node:http";

import {
  HUB_DESTINATION_ID_PATTERN,
  HUB_PROJECT_ID_PATTERN,
} from "./identifiers.js";
import { InvalidHubHttpRequestError } from "./request.js";

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SNAPSHOT_ID_PATTERN = /^pol_[a-f0-9]{64}$/u;

export type HubPolicyHttpRoute = {
  kind: "bundle" | "snapshots" | "approvals" | "revocations";
  projectId: string;
};

export class HubHttpRequestTooLargeError extends Error {}

export function matchHubPolicyRoute(pathname: string): HubPolicyHttpRoute | null {
  const segments = pathname.split("/");
  if (
    segments.length !== 6 || segments[0] !== "" || segments[1] !== "v1" ||
    segments[2] !== "policy" || segments[3] !== "projects"
  ) return null;
  let projectId: string;
  try {
    projectId = decodeURIComponent(segments[4]!);
  } catch {
    throw new InvalidHubHttpRequestError();
  }
  if (!HUB_PROJECT_ID_PATTERN.test(projectId)) throw new InvalidHubHttpRequestError();
  const kind = segments[5];
  if (!(["bundle", "snapshots", "approvals", "revocations"] as const).includes(
    kind as HubPolicyHttpRoute["kind"],
  )) return null;
  return { kind: kind as HubPolicyHttpRoute["kind"], projectId };
}

function one(parameters: URLSearchParams, name: string, required: boolean): string | null {
  const values = parameters.getAll(name);
  if (values.length > 1 || (required && values.length !== 1) || values[0] === "") {
    throw new InvalidHubHttpRequestError();
  }
  return values[0] ?? null;
}

export function policyQuery(parameters: URLSearchParams, includeCursor: boolean) {
  const allowed = new Set([
    "destinationId",
    "projectIdentityHash",
    ...(includeCursor ? ["currentSnapshotId"] : []),
  ]);
  for (const key of parameters.keys()) {
    if (!allowed.has(key)) throw new InvalidHubHttpRequestError();
  }
  const destinationId = one(parameters, "destinationId", true)!;
  const projectIdentityHash = one(parameters, "projectIdentityHash", true)!;
  const currentSnapshotId = includeCursor
    ? one(parameters, "currentSnapshotId", false)
    : null;
  if (
    !HUB_DESTINATION_ID_PATTERN.test(destinationId) ||
    !HASH_PATTERN.test(projectIdentityHash) ||
    (currentSnapshotId !== null && !SNAPSHOT_ID_PATTERN.test(currentSnapshotId))
  ) throw new InvalidHubHttpRequestError();
  return { destinationId, projectIdentityHash, currentSnapshotId };
}

export async function readBoundedJsonBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new InvalidHubHttpRequestError();
  }
  const length = request.headers["content-length"];
  if (length !== undefined) {
    if (!/^(0|[1-9][0-9]*)$/.test(length)) throw new InvalidHubHttpRequestError();
    if (Number(length) > maxBytes) throw new HubHttpRequestTooLargeError();
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.byteLength;
    if (bytes > maxBytes) throw new HubHttpRequestTooLargeError();
    chunks.push(value);
  }
  if (bytes === 0) throw new InvalidHubHttpRequestError();
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    return JSON.parse(text);
  } catch {
    throw new InvalidHubHttpRequestError();
  }
}
