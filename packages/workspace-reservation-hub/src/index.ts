import {
  hubWorkspaceCoordinationDigest,
  type HubWorkspaceCoordinationMutation,
  type HubWorkspaceReservationDecision,
} from "@lervo/hub-sync";
import type {
  WorkspaceReservationClaim,
  WorkspaceReservationDecision,
  WorkspaceReservationPort,
} from "@lervo/orchestrator";

export interface HubWorkspaceCoordinationTransport {
  coordinateWorkspace(mutation: HubWorkspaceCoordinationMutation): Promise<unknown>;
}

interface AuthenticatedResponse {
  authentication: { status: "verified" | "unverified" };
  body: unknown;
}

function authenticatedBody(value: unknown): unknown | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const response = value as Partial<AuthenticatedResponse>;
  if (
    response.authentication === undefined ||
    response.authentication.status !== "verified" ||
    !("body" in response)
  )
    return null;
  return response.body;
}

function reservationDecision(value: unknown): HubWorkspaceReservationDecision | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const decision = value as Partial<HubWorkspaceReservationDecision>;
  if (
    (decision.status === "granted" || decision.status === "duplicate") &&
    decision.reservation !== undefined &&
    typeof decision.reservation.reservationId === "string" &&
    typeof decision.reservation.expiresAt === "string"
  )
    return decision as HubWorkspaceReservationDecision;
  if (
    decision.status === "conflict" &&
    Array.isArray(decision.conflictingReservationIds) &&
    decision.conflictingReservationIds.every((item) => typeof item === "string")
  )
    return decision as HubWorkspaceReservationDecision;
  if (decision.status === "capacity_rejected" && decision.policyId === "workspace-coordination-v1")
    return decision as HubWorkspaceReservationDecision;
  return null;
}

export class HubWorkspaceReservationAdapter implements WorkspaceReservationPort {
  constructor(private readonly transport: HubWorkspaceCoordinationTransport) {}

  async reserve(claim: WorkspaceReservationClaim): Promise<WorkspaceReservationDecision> {
    const content = { schemaVersion: 1 as const, ...structuredClone(claim) };
    try {
      const response = await this.transport.coordinateWorkspace({
        operation: "reserve",
        request: { ...content, contentHash: hubWorkspaceCoordinationDigest(content) },
      });
      const decision = reservationDecision(authenticatedBody(response));
      if (decision === null) return { status: "unavailable" };
      if (decision.status === "granted" || decision.status === "duplicate")
        return {
          status: decision.status,
          reservationId: decision.reservation.reservationId,
          expiresAt: decision.reservation.expiresAt,
        };
      return { status: decision.status };
    } catch {
      return { status: "unavailable" };
    }
  }

  async release(input: {
    reservationId: string;
    projectId: string;
    repositoryIdentityHash: string;
    nodeId: string;
    generation: number;
    releasedAt: string;
  }): Promise<void> {
    const content = { schemaVersion: 1 as const, ...structuredClone(input) };
    const response = await this.transport.coordinateWorkspace({
      operation: "release",
      request: { ...content, contentHash: hubWorkspaceCoordinationDigest(content) },
    });
    const body = authenticatedBody(response);
    if (
      body === null ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      (body as { status?: unknown }).status !== "released"
    )
      throw new Error("The Hub workspace reservation release was not authenticated.");
  }
}

export * from "./summary-reconciliation.js";
