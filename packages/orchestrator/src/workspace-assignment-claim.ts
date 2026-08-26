import { createHash, randomBytes } from "node:crypto";

import {
  AgentWorkforceError,
  claimAssignment,
  listAssignments,
  type WorkforceAssignment,
} from "@lervo/agent-workforce";

export type WorkspaceCoordinationMode = "local_first" | "hub_coordinated";

export interface WorkspaceReservationScope {
  scopeDigest: string;
  ancestorDigests: string[];
}

export interface WorkspaceReservationClaim {
  reservationId: string;
  projectId: string;
  repositoryIdentityHash: string;
  assignmentId: string;
  workspaceId: string;
  nodeId: string;
  generation: number;
  baseCommit: string;
  integrationTargetDigest: string;
  scopes: WorkspaceReservationScope[];
  requestedAt: string;
  expiresAt: string;
  localLeaseExpiresAt: string;
  idempotencyKey: string;
}

export type WorkspaceReservationDecision =
  | { status: "granted" | "duplicate"; reservationId: string; expiresAt: string }
  | { status: "conflict" | "capacity_rejected" | "unavailable" };

export interface WorkspaceReservationPort {
  reserve(request: WorkspaceReservationClaim): Promise<WorkspaceReservationDecision>;
  release(input: {
    reservationId: string;
    projectId: string;
    repositoryIdentityHash: string;
    nodeId: string;
    generation: number;
    releasedAt: string;
  }): Promise<void>;
}

export interface ClaimedWorkspaceAssignment {
  assignment: WorkforceAssignment;
  workspaceId: string;
  coordinationMode: WorkspaceCoordinationMode;
  reservation: { reservationId: string; expiresAt: string } | null;
}

function digestScope(value: string): string {
  return `sha256:${createHash("sha256").update(`lervo-workspace-scope-v1\0${value}`).digest("hex")}`;
}

export function workspaceReservationScopes(expectedPaths: string[]): WorkspaceReservationScope[] {
  return [...new Set(expectedPaths)].sort().map((path) => {
    const parts = path === "*" ? ["*"] : path.split("/");
    const ancestors = parts.map((_, index) => parts.slice(0, index + 1).join("/"));
    return {
      scopeDigest: digestScope(path),
      ancestorDigests: ancestors.map(digestScope),
    };
  });
}

function id(prefix: "hrs" | "idk" | "wsp"): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export async function claimWorkspaceAssignment(input: {
  repositoryRoot: string;
  assignmentId: string;
  agentId: string;
  sessionId: string;
  mode: WorkspaceCoordinationMode;
  nodeId?: string;
  repositoryIdentityHash?: string;
  baseCommit?: string;
  integrationTargetDigest?: string;
  reservationPort?: WorkspaceReservationPort;
  leaseDurationMs?: number;
  now?: Date;
}): Promise<ClaimedWorkspaceAssignment> {
  const assignment = (await listAssignments(input.repositoryRoot)).find(
    (item) => item.assignmentId === input.assignmentId,
  );
  if (assignment === undefined)
    throw new AgentWorkforceError("assignment_not_found", "The workspace assignment is absent.");
  const now = input.now ?? new Date();
  const duration = input.leaseDurationMs ?? 5 * 60_000;
  const workspaceId = id("wsp");
  let reservation: { reservationId: string; expiresAt: string } | null = null;
  if (input.mode === "hub_coordinated") {
    if (
      input.reservationPort === undefined ||
      input.nodeId === undefined ||
      input.repositoryIdentityHash === undefined ||
      input.baseCommit === undefined ||
      input.integrationTargetDigest === undefined
    )
      throw new AgentWorkforceError(
        "assignment_lease_conflict",
        "Hub-coordinated assignment claim requires exact reservation coordinates.",
      );
    const expiresAt = new Date(now.getTime() + duration).toISOString();
    const requested = {
      reservationId: id("hrs"),
      projectId: assignment.projectId,
      repositoryIdentityHash: input.repositoryIdentityHash,
      assignmentId: assignment.assignmentId,
      workspaceId,
      nodeId: input.nodeId,
      generation: (assignment.lease?.generation ?? 0) + 1,
      baseCommit: input.baseCommit,
      integrationTargetDigest: input.integrationTargetDigest,
      scopes: workspaceReservationScopes(assignment.expectedPaths),
      requestedAt: now.toISOString(),
      expiresAt,
      localLeaseExpiresAt: expiresAt,
      idempotencyKey: id("idk"),
    };
    const decision = await input.reservationPort.reserve(requested);
    if (decision.status !== "granted" && decision.status !== "duplicate")
      throw new AgentWorkforceError(
        "assignment_lease_conflict",
        `Hub workspace reservation was not granted: ${decision.status}.`,
      );
    reservation = { reservationId: decision.reservationId, expiresAt: decision.expiresAt };
  }
  try {
    const claimed = await claimAssignment({
      repositoryRoot: input.repositoryRoot,
      assignmentId: input.assignmentId,
      agentId: input.agentId,
      sessionId: input.sessionId,
      leaseDurationMs: duration,
      now,
    });
    return { assignment: claimed, workspaceId, coordinationMode: input.mode, reservation };
  } catch (error) {
    if (reservation !== null && input.reservationPort !== undefined)
      await input.reservationPort.release({
        reservationId: reservation.reservationId,
        projectId: assignment.projectId,
        repositoryIdentityHash: input.repositoryIdentityHash!,
        nodeId: input.nodeId!,
        generation: (assignment.lease?.generation ?? 0) + 1,
        releasedAt: now.toISOString(),
      });
    throw error;
  }
}

export function workspaceCoordinationHealth(input: {
  mode: WorkspaceCoordinationMode;
  hubReachable: boolean;
  reservationStatus?: WorkspaceReservationDecision["status"];
  reservationGeneration?: number;
  localLeaseGeneration?: number;
  reservationExpiresAt?: string;
  now?: Date;
}): "disabled" | "ready" | "unavailable" | "conflicted" | "stale_generation" {
  if (input.mode === "local_first") return "disabled";
  if (!input.hubReachable || input.reservationStatus === "unavailable") return "unavailable";
  if (["conflict", "capacity_rejected"].includes(input.reservationStatus ?? ""))
    return "conflicted";
  if (
    input.reservationStatus === undefined ||
    input.reservationGeneration === undefined ||
    input.localLeaseGeneration === undefined ||
    input.reservationGeneration !== input.localLeaseGeneration ||
    input.reservationExpiresAt === undefined ||
    Date.parse(input.reservationExpiresAt) <= (input.now ?? new Date()).getTime()
  )
    return "stale_generation";
  return "ready";
}
