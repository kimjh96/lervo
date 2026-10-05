import { type DatabaseSync } from "node:sqlite";

import { canonicalJson } from "@lervo/event-contract";
import { type HubProjectCoordinate } from "@lervo/hub-sync";
import { type ProjectRegistrationRequest, type ProjectRegistrationResponse } from "@lervo/schemas";
import { planProjectRegistrationAcceptance } from "@lervo/sync-contract";

import { HubSyncStoreError } from "./errors.js";
import { loadProjectHead } from "./project-head.js";
import { sqliteRow } from "./sqlite-row.js";

function coordinateOf(request: ProjectRegistrationRequest): HubProjectCoordinate {
  return {
    destinationId: request.destinationId,
    projectId: request.project.projectId,
  };
}

export class HubRegistrationSQLiteRepository {
  constructor(private readonly database: DatabaseSync) {}

  matchesIdentity(input: HubProjectCoordinate & { repositoryIdentityHash: string }): boolean {
    const row = sqliteRow(
      this.database
        .prepare(
          "SELECT identity_hash FROM hub_projects WHERE destination_id = ? AND project_id = ?",
        )
        .get(input.destinationId, input.projectId),
    );
    return row?.identity_hash === input.repositoryIdentityHash;
  }

  register(input: {
    request: ProjectRegistrationRequest;
    acceptedAt: string;
  }): ProjectRegistrationResponse {
    const coordinate = coordinateOf(input.request);
    const current = loadProjectHead(this.database, coordinate);
    const planned = planProjectRegistrationAcceptance({
      current: current?.registration ?? null,
      cursor: current?.cursor ?? { seq: 0, eventHash: null },
      request: input.request,
      acceptedAt: input.acceptedAt,
    });
    const request = planned.record.request;
    if (current === null) {
      this.database
        .prepare(
          `
        INSERT INTO hub_projects (
          destination_id, project_id, registration_id, identity_hash, manifest_hash,
          request_json, registered_at, updated_at, cursor_seq, cursor_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
      `,
        )
        .run(
          coordinate.destinationId,
          coordinate.projectId,
          request.registrationId,
          request.projectIdentityHash,
          request.projectManifestHash,
          canonicalJson(request),
          planned.record.registeredAt,
          planned.record.updatedAt,
        );
      this.incrementProjectCount();
    } else {
      this.database
        .prepare(
          `
        UPDATE hub_projects
        SET registration_id = ?, identity_hash = ?, manifest_hash = ?, request_json = ?,
            registered_at = ?, updated_at = ?
        WHERE destination_id = ? AND project_id = ?
      `,
        )
        .run(
          request.registrationId,
          request.projectIdentityHash,
          request.projectManifestHash,
          canonicalJson(request),
          planned.record.registeredAt,
          planned.record.updatedAt,
          coordinate.destinationId,
          coordinate.projectId,
        );
    }
    const stored = loadProjectHead(this.database, coordinate);
    if (
      stored === null ||
      canonicalJson(stored.registration) !== canonicalJson(planned.record) ||
      canonicalJson(stored.cursor) !== canonicalJson(planned.response.cursor)
    ) {
      throw new HubSyncStoreError(
        "write_failed",
        "The Hub sync SQLite registration could not be verified in the same transaction.",
      );
    }
    return structuredClone(planned.response);
  }

  private incrementProjectCount(): void {
    const result = this.database
      .prepare(
        `
      UPDATE hub_sync_meta
      SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
      WHERE key = 'project_count'
    `,
      )
      .run();
    if (result.changes !== 1) {
      throw new HubSyncStoreError("integrity_failed", "The Hub project count metadata is missing.");
    }
  }
}
