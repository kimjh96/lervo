import { type DatabaseSync } from "node:sqlite";

import {
  HUB_WORKSPACE_COORDINATION_POLICY_V1,
  HubWorkspaceCoordinationError,
  type HubWorkspaceReservation,
  type HubWorkspaceScopeCoordinate,
  type HubWorkspaceSummaryState,
} from "@lervo/hub-sync";

export const workspaceSummaryTransitions: Readonly<
  Record<HubWorkspaceSummaryState, readonly HubWorkspaceSummaryState[]>
> = {
  provisioning: ["ready", "recovery_required"],
  ready: ["active", "recovery_required"],
  active: ["sealing", "recovery_required"],
  sealing: ["sealed", "recovery_required"],
  sealed: ["integration_pending", "recovery_required"],
  integration_pending: ["integrating", "integration_conflict", "recovery_required"],
  integrating: ["integrated", "integration_conflict", "recovery_required"],
  integrated: ["cleanup_eligible", "recovery_required"],
  integration_conflict: ["integration_pending", "recovery_required"],
  cleanup_eligible: ["removing", "recovery_required"],
  removing: ["removed", "cleanup_eligible", "recovery_required"],
  removed: [],
  recovery_required: ["cleanup_eligible", "removed"],
};

export function workspaceCoordinationFail(
  code: ConstructorParameters<typeof HubWorkspaceCoordinationError>[0],
  message: string,
): never {
  throw new HubWorkspaceCoordinationError(code, message);
}

export function workspaceCoordinationTime(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed))
    workspaceCoordinationFail("workspace_coordination_invalid", `The ${label} is invalid.`);
  return parsed;
}

export function workspaceCoordinationString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string")
    workspaceCoordinationFail("workspace_coordination_invalid", `The stored ${field} is invalid.`);
  return value;
}

export function workspaceCoordinationNumber(row: Record<string, unknown>, field: string): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    workspaceCoordinationFail("workspace_coordination_invalid", `The stored ${field} is invalid.`);
  return value;
}

function parseScopes(value: string): HubWorkspaceScopeCoordinate[] {
  try {
    return JSON.parse(value) as HubWorkspaceScopeCoordinate[];
  } catch {
    workspaceCoordinationFail(
      "workspace_coordination_invalid",
      "The stored workspace scopes are invalid.",
    );
  }
}

export function workspaceReservationRow(row: Record<string, unknown>): HubWorkspaceReservation {
  return {
    schemaVersion: 1,
    reservationId: workspaceCoordinationString(row, "reservation_id"),
    projectId: workspaceCoordinationString(row, "project_id"),
    repositoryIdentityHash: workspaceCoordinationString(row, "repository_identity_hash"),
    assignmentId: workspaceCoordinationString(row, "assignment_id"),
    workspaceId: workspaceCoordinationString(row, "workspace_id"),
    nodeId: workspaceCoordinationString(row, "node_id"),
    generation: workspaceCoordinationNumber(row, "generation"),
    baseCommit: workspaceCoordinationString(row, "base_commit"),
    integrationTargetDigest: workspaceCoordinationString(row, "integration_target_digest"),
    scopes: parseScopes(workspaceCoordinationString(row, "scopes_json")),
    state: workspaceCoordinationString(row, "state") as HubWorkspaceReservation["state"],
    requestedAt: workspaceCoordinationString(row, "requested_at"),
    expiresAt: workspaceCoordinationString(row, "expires_at"),
    localLeaseExpiresAt: workspaceCoordinationString(row, "local_lease_expires_at"),
    idempotencyKey: workspaceCoordinationString(row, "idempotency_key"),
    requestContentHash: workspaceCoordinationString(row, "request_content_hash"),
    revision: workspaceCoordinationNumber(row, "revision"),
    updatedAt: workspaceCoordinationString(row, "updated_at"),
  };
}

export class HubWorkspaceCoordinationPolicySQLiteRepository {
  constructor(private readonly database: DatabaseSync) {}

  ensure(input: {
    destinationId: string;
    projectId: string;
    repositoryIdentityHash: string;
    acceptedAt: string;
  }): void {
    const registered = this.database
      .prepare("SELECT 1 FROM hub_projects WHERE destination_id = ? AND project_id = ?")
      .get(input.destinationId, input.projectId);
    if (registered === undefined)
      workspaceCoordinationFail(
        "workspace_coordination_registration_required",
        "Workspace coordination requires a registered project.",
      );
    const policy = HUB_WORKSPACE_COORDINATION_POLICY_V1;
    this.database
      .prepare(
        `INSERT OR IGNORE INTO hub_workspace_coordination_policies (
          destination_id, project_id, repository_identity_hash, policy_id,
          max_active_reservations, max_retained_terminal_summaries,
          terminal_summary_retention_ms, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.destinationId,
        input.projectId,
        input.repositoryIdentityHash,
        policy.policyId,
        policy.maxActiveReservations,
        policy.maxRetainedTerminalSummaries,
        policy.terminalSummaryRetentionMs,
        input.acceptedAt,
      );
    const stored = this.database
      .prepare(
        `SELECT policy_id, max_active_reservations, max_retained_terminal_summaries,
          terminal_summary_retention_ms
        FROM hub_workspace_coordination_policies
        WHERE destination_id = ? AND project_id = ? AND repository_identity_hash = ?`,
      )
      .get(input.destinationId, input.projectId, input.repositoryIdentityHash) as
      Record<string, unknown> | undefined;
    if (
      stored === undefined ||
      stored.policy_id !== policy.policyId ||
      stored.max_active_reservations !== policy.maxActiveReservations ||
      stored.max_retained_terminal_summaries !== policy.maxRetainedTerminalSummaries ||
      stored.terminal_summary_retention_ms !== policy.terminalSummaryRetentionMs
    )
      workspaceCoordinationFail(
        "workspace_coordination_invalid",
        "The stored workspace coordination policy differs from version one.",
      );
  }
}
