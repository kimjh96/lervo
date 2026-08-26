import { type DatabaseSync } from "node:sqlite";

import {
  HUB_WORKSPACE_COORDINATION_POLICY_V1,
  isHubWorkspaceReservationRelease,
  isHubWorkspaceReservationRenewal,
  isHubWorkspaceReservationRequest,
  workspaceScopesConflict,
  type HubWorkspaceReservation,
  type HubWorkspaceReservationDecision,
  type HubWorkspaceReservationRelease,
  type HubWorkspaceReservationRenewal,
  type HubWorkspaceReservationRequest,
} from "@lervo/hub-sync";

import {
  HubWorkspaceCoordinationPolicySQLiteRepository,
  workspaceCoordinationFail,
  workspaceCoordinationTime,
  workspaceReservationRow,
} from "./workspace-coordination-common.js";

function reservationEvent(input: {
  reservation: HubWorkspaceReservation;
  previousState: HubWorkspaceReservation["state"] | "absent";
}) {
  return {
    schemaVersion: 1,
    type: "workspace.reservation.state.changed",
    reservationId: input.reservation.reservationId,
    projectId: input.reservation.projectId,
    repositoryIdentityHash: input.reservation.repositoryIdentityHash,
    assignmentId: input.reservation.assignmentId,
    workspaceId: input.reservation.workspaceId,
    nodeId: input.reservation.nodeId,
    generation: input.reservation.generation,
    integrationTargetDigest: input.reservation.integrationTargetDigest,
    scopeDigests: input.reservation.scopes.map((scope) => scope.scopeDigest),
    previousState: input.previousState,
    state: input.reservation.state,
    expiresAt: input.reservation.expiresAt,
    revision: input.reservation.revision,
    occurredAt: input.reservation.updatedAt,
  };
}

export class HubWorkspaceReservationSQLiteRepository {
  private readonly policy: HubWorkspaceCoordinationPolicySQLiteRepository;

  constructor(private readonly database: DatabaseSync) {
    this.policy = new HubWorkspaceCoordinationPolicySQLiteRepository(database);
  }

  private audit(
    destinationId: string,
    previousState: HubWorkspaceReservation["state"] | "absent",
    current: HubWorkspaceReservation,
  ): void {
    this.database
      .prepare(
        `INSERT INTO hub_workspace_reservation_audit (
          reservation_id, destination_id, project_id, repository_identity_hash,
          previous_state, state, generation, node_id, occurred_at, event_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        current.reservationId,
        destinationId,
        current.projectId,
        current.repositoryIdentityHash,
        previousState,
        current.state,
        current.generation,
        current.nodeId,
        current.updatedAt,
        JSON.stringify(reservationEvent({ reservation: current, previousState })),
      );
  }

  private expire(input: {
    destinationId: string;
    projectId: string;
    repositoryIdentityHash: string;
    acceptedAt: string;
  }): void {
    const rows = this.database
      .prepare(
        `SELECT * FROM hub_workspace_reservations
        WHERE destination_id = ? AND project_id = ? AND repository_identity_hash = ?
          AND state = 'granted' AND expires_at_ms <= ?
        ORDER BY reservation_id`,
      )
      .all(
        input.destinationId,
        input.projectId,
        input.repositoryIdentityHash,
        workspaceCoordinationTime(input.acceptedAt, "workspace coordination acceptedAt"),
      ) as Record<string, unknown>[];
    for (const row of rows) {
      const previous = workspaceReservationRow(row);
      this.database
        .prepare(
          `UPDATE hub_workspace_reservations
          SET state = 'expired', revision = revision + 1, updated_at = ?
          WHERE reservation_id = ? AND state = 'granted' AND revision = ?`,
        )
        .run(input.acceptedAt, previous.reservationId, previous.revision);
      this.audit(input.destinationId, "granted", {
        ...previous,
        state: "expired",
        revision: previous.revision + 1,
        updatedAt: input.acceptedAt,
      });
    }
  }

  reserve(input: {
    destinationId: string;
    request: HubWorkspaceReservationRequest;
    acceptedAt: string;
  }): HubWorkspaceReservationDecision {
    if (!isHubWorkspaceReservationRequest(input.request))
      workspaceCoordinationFail(
        "workspace_coordination_invalid",
        "The workspace reservation request is invalid.",
      );
    this.policy.ensure({
      ...input.request,
      destinationId: input.destinationId,
      acceptedAt: input.acceptedAt,
    });
    this.expire({
      ...input.request,
      destinationId: input.destinationId,
      acceptedAt: input.acceptedAt,
    });
    const existing = this.database
      .prepare(
        `SELECT * FROM hub_workspace_reservations
        WHERE destination_id = ? AND project_id = ? AND repository_identity_hash = ?
          AND idempotency_key = ?`,
      )
      .get(
        input.destinationId,
        input.request.projectId,
        input.request.repositoryIdentityHash,
        input.request.idempotencyKey,
      ) as Record<string, unknown> | undefined;
    if (existing !== undefined) {
      const current = workspaceReservationRow(existing);
      if (current.requestContentHash !== input.request.contentHash)
        workspaceCoordinationFail(
          "workspace_coordination_conflict",
          "The workspace reservation idempotency key has different content.",
        );
      return { status: "duplicate", reservation: current };
    }
    const active = (
      this.database
        .prepare(
          `SELECT * FROM hub_workspace_reservations
          WHERE destination_id = ? AND project_id = ? AND repository_identity_hash = ?
            AND state = 'granted'
          ORDER BY reservation_id`,
        )
        .all(
          input.destinationId,
          input.request.projectId,
          input.request.repositoryIdentityHash,
        ) as Record<string, unknown>[]
    ).map(workspaceReservationRow);
    if (active.length >= HUB_WORKSPACE_COORDINATION_POLICY_V1.maxActiveReservations)
      return { status: "capacity_rejected", policyId: "workspace-coordination-v1" };
    const conflicts = active
      .filter((current) => workspaceScopesConflict(current.scopes, input.request.scopes))
      .map((current) => current.reservationId);
    if (conflicts.length > 0)
      return { status: "conflict", conflictingReservationIds: conflicts.slice(0, 16) };
    const { contentHash: requestContentHash, ...request } = input.request;
    const pending: HubWorkspaceReservation = {
      ...request,
      state: "pending",
      requestContentHash,
      revision: 1,
      updatedAt: input.acceptedAt,
    };
    this.database
      .prepare(
        `INSERT INTO hub_workspace_reservations (
          reservation_id, destination_id, project_id, repository_identity_hash,
          assignment_id, workspace_id, node_id, generation, base_commit,
          integration_target_digest, scopes_json, state, requested_at, expires_at,
          expires_at_ms, local_lease_expires_at, local_lease_expires_at_ms,
          idempotency_key, request_content_hash, revision, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        pending.reservationId,
        input.destinationId,
        pending.projectId,
        pending.repositoryIdentityHash,
        pending.assignmentId,
        pending.workspaceId,
        pending.nodeId,
        pending.generation,
        pending.baseCommit,
        pending.integrationTargetDigest,
        JSON.stringify(pending.scopes),
        pending.state,
        pending.requestedAt,
        pending.expiresAt,
        workspaceCoordinationTime(pending.expiresAt, "workspace reservation expiresAt"),
        pending.localLeaseExpiresAt,
        workspaceCoordinationTime(
          pending.localLeaseExpiresAt,
          "workspace reservation local lease expiry",
        ),
        pending.idempotencyKey,
        pending.requestContentHash,
        pending.revision,
        pending.updatedAt,
      );
    this.audit(input.destinationId, "absent", pending);
    const granted: HubWorkspaceReservation = { ...pending, state: "granted", revision: 2 };
    this.database
      .prepare(
        `UPDATE hub_workspace_reservations SET state = 'granted', revision = 2
        WHERE reservation_id = ? AND state = 'pending' AND revision = 1`,
      )
      .run(granted.reservationId);
    this.audit(input.destinationId, "pending", granted);
    return { status: "granted", reservation: granted };
  }

  renew(input: {
    destinationId: string;
    request: HubWorkspaceReservationRenewal;
    acceptedAt: string;
  }): HubWorkspaceReservation {
    if (!isHubWorkspaceReservationRenewal(input.request))
      workspaceCoordinationFail(
        "workspace_coordination_invalid",
        "The workspace reservation renewal is invalid.",
      );
    this.policy.ensure({
      ...input.request,
      destinationId: input.destinationId,
      acceptedAt: input.acceptedAt,
    });
    this.expire({
      ...input.request,
      destinationId: input.destinationId,
      acceptedAt: input.acceptedAt,
    });
    const row = this.database
      .prepare("SELECT * FROM hub_workspace_reservations WHERE reservation_id = ?")
      .get(input.request.reservationId) as Record<string, unknown> | undefined;
    if (row === undefined)
      workspaceCoordinationFail("workspace_coordination_conflict", "The reservation is absent.");
    const current = workspaceReservationRow(row);
    if (
      current.state !== "granted" ||
      current.projectId !== input.request.projectId ||
      current.repositoryIdentityHash !== input.request.repositoryIdentityHash ||
      current.nodeId !== input.request.nodeId ||
      current.generation !== input.request.generation ||
      Date.parse(input.request.expiresAt) <= Date.parse(current.expiresAt)
    )
      workspaceCoordinationFail(
        "workspace_coordination_stale_generation",
        "The workspace reservation renewal is stale or not increasing.",
      );
    const next: HubWorkspaceReservation = {
      ...current,
      expiresAt: input.request.expiresAt,
      localLeaseExpiresAt: input.request.localLeaseExpiresAt,
      revision: current.revision + 1,
      updatedAt: input.acceptedAt,
    };
    this.database
      .prepare(
        `UPDATE hub_workspace_reservations
        SET expires_at = ?, expires_at_ms = ?, local_lease_expires_at = ?,
          local_lease_expires_at_ms = ?, revision = ?, updated_at = ?
        WHERE reservation_id = ? AND state = 'granted' AND revision = ?`,
      )
      .run(
        next.expiresAt,
        workspaceCoordinationTime(next.expiresAt, "workspace reservation expiry"),
        next.localLeaseExpiresAt,
        workspaceCoordinationTime(next.localLeaseExpiresAt, "workspace local lease expiry"),
        next.revision,
        next.updatedAt,
        next.reservationId,
        current.revision,
      );
    this.audit(input.destinationId, "granted", next);
    return next;
  }

  release(input: {
    destinationId: string;
    request: HubWorkspaceReservationRelease;
    acceptedAt: string;
  }): HubWorkspaceReservation {
    if (!isHubWorkspaceReservationRelease(input.request))
      workspaceCoordinationFail(
        "workspace_coordination_invalid",
        "The workspace reservation release is invalid.",
      );
    const row = this.database
      .prepare("SELECT * FROM hub_workspace_reservations WHERE reservation_id = ?")
      .get(input.request.reservationId) as Record<string, unknown> | undefined;
    if (row === undefined)
      workspaceCoordinationFail("workspace_coordination_conflict", "The reservation is absent.");
    const current = workspaceReservationRow(row);
    if (
      current.projectId !== input.request.projectId ||
      current.repositoryIdentityHash !== input.request.repositoryIdentityHash ||
      current.nodeId !== input.request.nodeId ||
      current.generation !== input.request.generation
    )
      workspaceCoordinationFail(
        "workspace_coordination_stale_generation",
        "The reservation release is stale.",
      );
    if (current.state === "released") return current;
    if (current.state !== "granted")
      workspaceCoordinationFail(
        "workspace_coordination_conflict",
        "Only a granted reservation can be released.",
      );
    const next: HubWorkspaceReservation = {
      ...current,
      state: "released",
      revision: current.revision + 1,
      updatedAt: input.acceptedAt,
    };
    this.database
      .prepare(
        `UPDATE hub_workspace_reservations
        SET state = 'released', revision = ?, updated_at = ?
        WHERE reservation_id = ? AND state = 'granted' AND revision = ?`,
      )
      .run(next.revision, next.updatedAt, next.reservationId, current.revision);
    this.audit(input.destinationId, "granted", next);
    return next;
  }
}
