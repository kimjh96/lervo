import { createHash } from "node:crypto";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40,64}$/u;
const RESERVATION_ID = /^hrs_[a-f0-9]{24}$/u;
const WORKSPACE_ID = /^wsp_[a-f0-9]{24}$/u;
const ASSIGNMENT_ID = /^asn_[a-f0-9]{24}$/u;
const NODE_ID = /^nod_[A-Za-z0-9_-]{8,128}$/u;
const IDEMPOTENCY_KEY = /^idk_[A-Za-z0-9_-]{8,128}$/u;
const MINIMUM_LEASE_MS = 5_000;
const MAXIMUM_LEASE_MS = 30 * 60_000;

export const HUB_WORKSPACE_COORDINATION_POLICY_V1 = {
  schemaVersion: 1 as const,
  policyId: "workspace-coordination-v1" as const,
  maxActiveReservations: 32,
  maxRetainedTerminalSummaries: 128,
  terminalSummaryRetentionMs: 30 * 24 * 60 * 60_000,
};

export interface HubWorkspaceScopeCoordinate {
  scopeDigest: string;
  ancestorDigests: string[];
}

export interface HubWorkspaceReservationRequest {
  schemaVersion: 1;
  reservationId: string;
  projectId: string;
  repositoryIdentityHash: string;
  assignmentId: string;
  workspaceId: string;
  nodeId: string;
  generation: number;
  baseCommit: string;
  integrationTargetDigest: string;
  scopes: HubWorkspaceScopeCoordinate[];
  requestedAt: string;
  expiresAt: string;
  localLeaseExpiresAt: string;
  idempotencyKey: string;
  contentHash: string;
}

export interface HubWorkspaceReservation {
  schemaVersion: 1;
  reservationId: string;
  projectId: string;
  repositoryIdentityHash: string;
  assignmentId: string;
  workspaceId: string;
  nodeId: string;
  generation: number;
  baseCommit: string;
  integrationTargetDigest: string;
  scopes: HubWorkspaceScopeCoordinate[];
  state: "pending" | "granted" | "released" | "expired";
  requestedAt: string;
  expiresAt: string;
  localLeaseExpiresAt: string;
  idempotencyKey: string;
  requestContentHash: string;
  revision: number;
  updatedAt: string;
}

export type HubWorkspaceReservationDecision =
  | { status: "granted" | "duplicate"; reservation: HubWorkspaceReservation }
  | { status: "conflict"; conflictingReservationIds: string[] }
  | { status: "capacity_rejected"; policyId: "workspace-coordination-v1" };

export interface HubWorkspaceReservationRenewal {
  schemaVersion: 1;
  reservationId: string;
  projectId: string;
  repositoryIdentityHash: string;
  nodeId: string;
  generation: number;
  requestedAt: string;
  expiresAt: string;
  localLeaseExpiresAt: string;
  contentHash: string;
}

export interface HubWorkspaceReservationRelease {
  schemaVersion: 1;
  reservationId: string;
  projectId: string;
  repositoryIdentityHash: string;
  nodeId: string;
  generation: number;
  releasedAt: string;
  contentHash: string;
}

export type HubWorkspaceSummaryState =
  | "provisioning"
  | "ready"
  | "active"
  | "sealing"
  | "sealed"
  | "integration_pending"
  | "integrating"
  | "integrated"
  | "integration_conflict"
  | "cleanup_eligible"
  | "removing"
  | "removed"
  | "recovery_required";

export interface HubWorkspaceSummary {
  schemaVersion: 1;
  projectId: string;
  repositoryIdentityHash: string;
  workspaceId: string;
  assignmentId: string;
  nodeId: string;
  generation: number;
  state: HubWorkspaceSummaryState;
  hostKind: "git" | "orca";
  processObservation: "quiescent" | "live" | "unavailable";
  terminalCount: number | null;
  integrationEvidenceId: string | null;
  cleanupPlanId: string | null;
  updatedAt: string;
  contentHash: string;
}

export interface HubWorkspaceCoordinationStore {
  reserveWorkspace(input: {
    destinationId: string;
    request: HubWorkspaceReservationRequest;
    acceptedAt: string;
  }): Promise<HubWorkspaceReservationDecision>;
  renewWorkspaceReservation(input: {
    destinationId: string;
    request: HubWorkspaceReservationRenewal;
    acceptedAt: string;
  }): Promise<HubWorkspaceReservation>;
  releaseWorkspaceReservation(input: {
    destinationId: string;
    request: HubWorkspaceReservationRelease;
    acceptedAt: string;
  }): Promise<HubWorkspaceReservation>;
  publishWorkspaceSummary(input: {
    destinationId: string;
    summary: HubWorkspaceSummary;
    acceptedAt: string;
  }): Promise<{ status: "created" | "updated" | "duplicate"; summary: HubWorkspaceSummary }>;
  listWorkspaceSummaries(input: {
    destinationId: string;
    projectId: string;
    repositoryIdentityHash: string;
    acceptedAt: string;
  }): Promise<HubWorkspaceSummary[]>;
}

export class HubWorkspaceCoordinationError extends Error {
  constructor(
    readonly code:
      | "workspace_coordination_invalid"
      | "workspace_coordination_conflict"
      | "workspace_coordination_capacity"
      | "workspace_coordination_registration_required"
      | "workspace_coordination_stale_generation",
    message: string,
  ) {
    super(message);
    this.name = "HubWorkspaceCoordinationError";
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function hubWorkspaceCoordinationDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function validTime(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function validProjectCoordinate(projectId: string, repositoryIdentityHash: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._:-]{1,199}$/u.test(projectId) && HASH.test(repositoryIdentityHash)
  );
}

function validScopes(scopes: HubWorkspaceScopeCoordinate[]): boolean {
  return (
    scopes.length > 0 &&
    scopes.length <= 128 &&
    scopes.every(
      (scope) =>
        HASH.test(scope.scopeDigest) &&
        scope.ancestorDigests.length > 0 &&
        scope.ancestorDigests.length <= 128 &&
        scope.ancestorDigests.every((item) => HASH.test(item)) &&
        new Set(scope.ancestorDigests).size === scope.ancestorDigests.length &&
        scope.ancestorDigests.at(-1) === scope.scopeDigest,
    ) &&
    new Set(scopes.map((scope) => scope.scopeDigest)).size === scopes.length
  );
}

function validLeaseTimes(
  requestedAt: string,
  expiresAt: string,
  localLeaseExpiresAt: string,
): boolean {
  if (![requestedAt, expiresAt, localLeaseExpiresAt].every(validTime)) return false;
  const duration = Date.parse(expiresAt) - Date.parse(requestedAt);
  return (
    duration >= MINIMUM_LEASE_MS &&
    duration <= MAXIMUM_LEASE_MS &&
    Date.parse(expiresAt) <= Date.parse(localLeaseExpiresAt)
  );
}

export function isHubWorkspaceReservationRequest(request: HubWorkspaceReservationRequest): boolean {
  const { contentHash, ...content } = request;
  return (
    request.schemaVersion === 1 &&
    RESERVATION_ID.test(request.reservationId) &&
    validProjectCoordinate(request.projectId, request.repositoryIdentityHash) &&
    ASSIGNMENT_ID.test(request.assignmentId) &&
    WORKSPACE_ID.test(request.workspaceId) &&
    NODE_ID.test(request.nodeId) &&
    Number.isSafeInteger(request.generation) &&
    request.generation >= 1 &&
    COMMIT.test(request.baseCommit) &&
    HASH.test(request.integrationTargetDigest) &&
    validScopes(request.scopes) &&
    validLeaseTimes(request.requestedAt, request.expiresAt, request.localLeaseExpiresAt) &&
    IDEMPOTENCY_KEY.test(request.idempotencyKey) &&
    HASH.test(contentHash) &&
    hubWorkspaceCoordinationDigest(content) === contentHash
  );
}

export function isHubWorkspaceReservationRenewal(request: HubWorkspaceReservationRenewal): boolean {
  const { contentHash, ...content } = request;
  return (
    request.schemaVersion === 1 &&
    RESERVATION_ID.test(request.reservationId) &&
    validProjectCoordinate(request.projectId, request.repositoryIdentityHash) &&
    NODE_ID.test(request.nodeId) &&
    Number.isSafeInteger(request.generation) &&
    request.generation >= 1 &&
    validLeaseTimes(request.requestedAt, request.expiresAt, request.localLeaseExpiresAt) &&
    HASH.test(contentHash) &&
    hubWorkspaceCoordinationDigest(content) === contentHash
  );
}

export function isHubWorkspaceReservationRelease(request: HubWorkspaceReservationRelease): boolean {
  const { contentHash, ...content } = request;
  return (
    request.schemaVersion === 1 &&
    RESERVATION_ID.test(request.reservationId) &&
    validProjectCoordinate(request.projectId, request.repositoryIdentityHash) &&
    NODE_ID.test(request.nodeId) &&
    Number.isSafeInteger(request.generation) &&
    request.generation >= 1 &&
    validTime(request.releasedAt) &&
    HASH.test(contentHash) &&
    hubWorkspaceCoordinationDigest(content) === contentHash
  );
}

export function isHubWorkspaceSummary(value: unknown): value is HubWorkspaceSummary {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const summary = value as HubWorkspaceSummary;
  const { contentHash, ...content } = summary;
  return (
    summary.schemaVersion === 1 &&
    validProjectCoordinate(summary.projectId, summary.repositoryIdentityHash) &&
    WORKSPACE_ID.test(summary.workspaceId) &&
    ASSIGNMENT_ID.test(summary.assignmentId) &&
    NODE_ID.test(summary.nodeId) &&
    Number.isSafeInteger(summary.generation) &&
    summary.generation >= 1 &&
    [
      "provisioning",
      "ready",
      "active",
      "sealing",
      "sealed",
      "integration_pending",
      "integrating",
      "integrated",
      "integration_conflict",
      "cleanup_eligible",
      "removing",
      "removed",
      "recovery_required",
    ].includes(summary.state) &&
    ["git", "orca"].includes(summary.hostKind) &&
    ["quiescent", "live", "unavailable"].includes(summary.processObservation) &&
    (summary.terminalCount === null ||
      (Number.isSafeInteger(summary.terminalCount) && summary.terminalCount >= 0)) &&
    (summary.integrationEvidenceId === null ||
      /^int_[a-f0-9]{24}$/u.test(summary.integrationEvidenceId)) &&
    (summary.cleanupPlanId === null || /^wcp_[a-f0-9]{24}$/u.test(summary.cleanupPlanId)) &&
    validTime(summary.updatedAt) &&
    HASH.test(contentHash) &&
    hubWorkspaceCoordinationDigest(content) === contentHash
  );
}

export function workspaceScopesConflict(
  left: HubWorkspaceScopeCoordinate[],
  right: HubWorkspaceScopeCoordinate[],
): boolean {
  return left.some((leftScope) =>
    right.some(
      (rightScope) =>
        leftScope.ancestorDigests.includes(rightScope.scopeDigest) ||
        rightScope.ancestorDigests.includes(leftScope.scopeDigest),
    ),
  );
}
