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

function registrationIdentity(input: {
  projectId: string;
  createdAt: string;
}): object {
  return {
    schemaVersion: 1,
    projectId: input.projectId,
    createdAt: input.createdAt,
  };
}

function registrationCoordinate(input: {
  destinationId: string;
  identityHash: string;
}): object {
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
    throw new SyncContractError("invalid_registration", "project manifest가 유효하지 않습니다.");
  }
  return syncContentHash(manifest);
}

export function calculateProjectRegistrationId(input: {
  destinationId: string;
  identityHash: string;
}): string {
  return syncContentId("hpr", registrationCoordinate(input));
}

export function assertProjectRegistrationRequest(
  request: ProjectRegistrationRequest,
): void {
  if (!validateSchema("projectRegistrationRequest", request).valid) {
    throw new SyncContractError("invalid_registration", "project registration 계약이 유효하지 않습니다.");
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
      "project registration의 manifest, identity hash와 ID가 입력 좌표와 다릅니다.",
    );
  }
}

export function createProjectRegistrationRequest(input: {
  manifest: ProjectManifest;
  destinationId: string;
  requestedAt: string;
}): ProjectRegistrationRequest {
  if (!validateSchema("project", input.manifest).valid) {
    throw new SyncContractError("invalid_registration", "project manifest가 유효하지 않습니다.");
  }
  if (!input.manifest.dataPolicy.hubSyncEnabled) {
    throw new SyncContractError(
      "project_sync_disabled",
      "project data policy가 Hub 동기화를 허용하지 않습니다.",
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
    throw new SyncContractError("invalid_registration", "project registration 응답이 유효하지 않습니다.");
  }
  if (
    input.response.registrationId !== input.request.registrationId ||
    input.response.projectId !== input.request.project.projectId ||
    input.response.destinationId !== input.request.destinationId
  ) {
    throw new SyncContractError(
      "invalid_registration",
      "project registration 응답이 요청 좌표와 다릅니다.",
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
        "같은 Hub project 좌표에 서로 다른 로컬 project identity를 등록할 수 없습니다.",
      );
    }
    registeredAt = input.current.registeredAt;
    status = comparableRegistration(input.current.request) === comparableRegistration(input.request)
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
