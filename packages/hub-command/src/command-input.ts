import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import type { RemoteCommandPayloadReference, RemoteCommandTarget } from "@lervo/schemas";

import { HubCommandError } from "./errors.js";
import type { AuthorHubCommandRequest } from "./types.js";

const DESTINATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const PRINCIPAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;
const IDEMPOTENCY_PATTERN = /^idk_[A-Za-z0-9][A-Za-z0-9_-]{15,63}$/u;

export function hashHubCommandValue(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function calculateHubCommandArtifactId(input: {
  destinationId: string;
  target: RemoteCommandTarget;
  contentHash: string;
}): string {
  return `art_${hashHubCommandValue(canonicalJson(input)).slice("sha256:".length)}`;
}

export function calculateHubCommandSubmissionHash(input: {
  destinationId: string;
  target: RemoteCommandTarget;
  idempotencyKey: string;
  roleId: string;
  provider: string;
  risk: "low" | "medium" | "high";
  verificationSuiteIds: string[];
  lifetimeMs: number;
  request: RemoteCommandPayloadReference;
}): string {
  return hashHubCommandValue(canonicalJson({ schemaVersion: 1, ...structuredClone(input) }));
}

export function validateHubCommandAuthoringInput(input: {
  destinationId: string;
  principalId: string;
  target: RemoteCommandTarget;
  authoredAt: string;
  request: AuthorHubCommandRequest;
  bytes: Uint8Array;
}): string {
  const { request, bytes } = input;
  if (
    typeof input.destinationId !== "string" ||
    typeof input.principalId !== "string" ||
    typeof input.authoredAt !== "string" ||
    !DESTINATION_PATTERN.test(input.destinationId) ||
    !Number.isFinite(Date.parse(input.authoredAt)) ||
    !PRINCIPAL_PATTERN.test(input.principalId) ||
    typeof input.target?.projectId !== "string" ||
    !/^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(input.target.projectId) ||
    typeof input.target.projectIdentityHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(input.target.projectIdentityHash) ||
    typeof request.idempotencyKey !== "string" ||
    typeof request.lifetimeMs !== "number" ||
    typeof request.request !== "string" ||
    typeof request.roleId !== "string" ||
    typeof request.provider !== "string" ||
    typeof request.risk !== "string" ||
    !IDEMPOTENCY_PATTERN.test(request.idempotencyKey) ||
    !Number.isSafeInteger(request.lifetimeMs) ||
    request.lifetimeMs < 1_000 ||
    request.lifetimeMs > 5 * 60_000 ||
    bytes.byteLength < 1 ||
    bytes.byteLength > 65_536 ||
    request.request.includes("\u0000") ||
    new TextDecoder("utf-8", { fatal: true }).decode(bytes) !== request.request ||
    !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(request.roleId) ||
    request.roleId.length > 100 ||
    !/^[a-z][a-z0-9_-]*$/u.test(request.provider) ||
    request.provider.length > 64 ||
    !["low", "medium", "high"].includes(request.risk) ||
    !Array.isArray(request.verificationSuiteIds) ||
    request.verificationSuiteIds.length < 1 ||
    request.verificationSuiteIds.length > 16 ||
    new Set(request.verificationSuiteIds).size !== request.verificationSuiteIds.length ||
    !request.verificationSuiteIds.every(
      (id) => id.length <= 150 && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(id),
    )
  )
    throw new HubCommandError("invalid_request", "The Hub command authoring request is invalid.");
  return hashHubCommandValue(`${input.target.projectIdentityHash}\0${input.principalId}`);
}
