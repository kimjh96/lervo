import { type DatabaseSync } from "node:sqlite";

import type {
  HubWorkspaceReservationDecision,
  HubWorkspaceReservationRelease,
  HubWorkspaceReservationRenewal,
  HubWorkspaceReservationRequest,
  HubWorkspaceSummary,
} from "@lervo/hub-sync";

import { HubWorkspaceReservationSQLiteRepository } from "./workspace-reservation-repository.js";
import { HubWorkspaceSummarySQLiteRepository } from "./workspace-summary-repository.js";

export class HubWorkspaceCoordinationSQLiteRepository {
  private readonly reservations: HubWorkspaceReservationSQLiteRepository;
  private readonly summaries: HubWorkspaceSummarySQLiteRepository;

  constructor(database: DatabaseSync) {
    this.reservations = new HubWorkspaceReservationSQLiteRepository(database);
    this.summaries = new HubWorkspaceSummarySQLiteRepository(database);
  }

  reserve(input: {
    destinationId: string;
    request: HubWorkspaceReservationRequest;
    acceptedAt: string;
  }): HubWorkspaceReservationDecision {
    return this.reservations.reserve(input);
  }

  renew(input: {
    destinationId: string;
    request: HubWorkspaceReservationRenewal;
    acceptedAt: string;
  }) {
    return this.reservations.renew(input);
  }

  release(input: {
    destinationId: string;
    request: HubWorkspaceReservationRelease;
    acceptedAt: string;
  }) {
    return this.reservations.release(input);
  }

  publishSummary(input: {
    destinationId: string;
    summary: HubWorkspaceSummary;
    acceptedAt: string;
  }) {
    return this.summaries.publish(input);
  }

  listSummaries(input: {
    destinationId: string;
    projectId: string;
    repositoryIdentityHash: string;
    acceptedAt: string;
  }) {
    return this.summaries.list(input);
  }
}
