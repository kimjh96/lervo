import { canonicalJson } from "@lervo/event-contract";
import {
  validateSchema,
  type EventSyncCursor,
  type ProjectManifest,
  type ProjectRegistrationRequest,
  type ProjectRegistrationResponse,
} from "@lervo/schemas";

import { SyncContractError } from "./errors.js";
import { syncContentHash, syncContentId } from "./hash.js";

export interface ProjectRegistrationRecord {
  request: ProjectRegistrationRequest;
  registeredAt: string;
  updatedAt: string;
}

function registrationIdentity(input: { projectId: string; createdAt: string }): object {
  return {
    schemaVersion: 1,
    projectId: input.projectId,
    createdAt: input.createdAt,
  };
}

function registrationCoordinate(input: { destinationId: string; identityHash: string }): object {
  return {
    schemaVersion: 1,
    destinationId: input.destinationId,
    identityHash: input.identityHash,
  };
}

export function calculateProjectIdentityHash(input: {
  projectId: string;
  createdAt: string;
}): string {
  return syncContentHash(registrationIdentity(input));
}

export function calculateProjectManifestHash(manifest: ProjectManifest): string {
  if (!validateSchema("project", manifest).valid) {
    throw new SyncContractError("invalid_registration", "The project manifest is invalid.");
  }
  return syncContentHash(manifest);
}

export function calculateProjectRegistrationId(input: {
  destinationId: string;
  identityHash: string;
}): string {
  return syncContentId("hpr", registrationCoordinate(input));
}

export function assertProjectRegistrationRequest(request: ProjectRegistrationRequest): void {
  if (!validateSchema("projectRegistrationRequest", request).valid) {
    throw new SyncContractError(
      "invalid_registration",
      "The project registration contract is invalid.",
    );
  }
  const identityHash = calculateProjectIdentityHash(request.project);
  const manifestHash = calculateProjectManifestHash(request.project);
  const registrationId = calculateProjectRegistrationId({
    destinationId: request.destinationId,
    identityHash,
  });
  if (
    !request.project.dataPolicy.hubSyncEnabled ||
    request.projectIdentityHash !== identityHash ||
    request.projectManifestHash !== manifestHash ||
    request.registrationId !== registrationId
  ) {
    throw new SyncContractError(
      "invalid_registration",
      "The project registration manifest, identity hash, and ID differ from the input coordinates.",
    );
  }
}

export function createProjectRegistrationRequest(input: {
  manifest: ProjectManifest;
  destinationId: string;
  requestedAt: string;
}): ProjectRegistrationRequest {
  if (!validateSchema("project", input.manifest).valid) {
    throw new SyncContractError("invalid_registration", "The project manifest is invalid.");
  }
  if (!input.manifest.dataPolicy.hubSyncEnabled) {
    throw new SyncContractError(
      "project_sync_disabled",
      "The project data policy does not allow Hub synchronization.",
    );
  }
  const identityHash = calculateProjectIdentityHash(input.manifest);
  const request: ProjectRegistrationRequest = {
    schemaVersion: 1,
    registrationId: calculateProjectRegistrationId({
      destinationId: input.destinationId,
      identityHash,
    }),
    destinationId: input.destinationId,
    requestedAt: input.requestedAt,
    project: structuredClone(input.manifest),
    projectIdentityHash: identityHash,
    projectManifestHash: calculateProjectManifestHash(input.manifest),
    syncPolicy: {
      hubSyncEnabled: true,
      eventPayloadMode: "allowlist",
      artifactMode: "none",
    },
  };
  assertProjectRegistrationRequest(request);
  return structuredClone(request);
}

function comparableRegistration(request: ProjectRegistrationRequest): string {
  const { requestedAt: _requestedAt, ...stable } = request;
  return canonicalJson(stable);
}

export function assertProjectRegistrationResponse(input: {
  request: ProjectRegistrationRequest;
  response: ProjectRegistrationResponse;
}): void {
  assertProjectRegistrationRequest(input.request);
  if (!validateSchema("projectRegistrationResponse", input.response).valid) {
    throw new SyncContractError(
      "invalid_registration",
      "The project registration response is invalid.",
    );
  }
  if (
    input.response.registrationId !== input.request.registrationId ||
    input.response.projectId !== input.request.project.projectId ||
    input.response.destinationId !== input.request.destinationId
  ) {
    throw new SyncContractError(
      "invalid_registration",
      "The project registration response differs from the request coordinates.",
    );
  }
}

export function planProjectRegistrationAcceptance(input: {
  current: ProjectRegistrationRecord | null;
  cursor: EventSyncCursor;
  request: ProjectRegistrationRequest;
  acceptedAt: string;
}): { record: ProjectRegistrationRecord; response: ProjectRegistrationResponse } {
  assertProjectRegistrationRequest(input.request);
  let status: ProjectRegistrationResponse["status"] = "registered";
  let registeredAt = input.acceptedAt;
  if (input.current !== null) {
    assertProjectRegistrationRequest(input.current.request);
    if (
      input.current.request.destinationId !== input.request.destinationId ||
      input.current.request.project.projectId !== input.request.project.projectId ||
      input.current.request.projectIdentityHash !== input.request.projectIdentityHash ||
      input.current.request.registrationId !== input.request.registrationId
    ) {
      throw new SyncContractError(
        "registration_identity_conflict",
        "Different local project identities cannot be registered at the same Hub project coordinates.",
      );
    }
    registeredAt = input.current.registeredAt;
    status =
      comparableRegistration(input.current.request) === comparableRegistration(input.request)
        ? "unchanged"
        : "updated";
  }
  const record: ProjectRegistrationRecord = {
    request: structuredClone(input.request),
    registeredAt,
    updatedAt: input.acceptedAt,
  };
  const response: ProjectRegistrationResponse = {
    schemaVersion: 1,
    registrationId: input.request.registrationId,
    projectId: input.request.project.projectId,
    destinationId: input.request.destinationId,
    status,
    cursor: structuredClone(input.cursor),
    acceptedAt: input.acceptedAt,
  };
  assertProjectRegistrationResponse({ request: input.request, response });
  return { record, response };
}
