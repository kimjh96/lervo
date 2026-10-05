import { type DatabaseSync } from "node:sqlite";

import { type HubProjectCoordinate } from "@lervo/hub-sync";

import { decodeProjectHead, type ProjectHead } from "./row-codec.js";
import { sqliteRow } from "./sqlite-row.js";

export const PROJECT_COLUMNS = `
  destination_id, project_id, registration_id, identity_hash, manifest_hash,
  request_json, registered_at, updated_at, cursor_seq, cursor_hash
`;

export function loadProjectHead(
  database: DatabaseSync,
  coordinate: HubProjectCoordinate,
): ProjectHead | null {
  const row = sqliteRow(
    database
      .prepare(
        `
    SELECT ${PROJECT_COLUMNS}
    FROM hub_projects
    WHERE destination_id = ? AND project_id = ?
  `,
      )
      .get(coordinate.destinationId, coordinate.projectId),
  );
  return row === undefined ? null : decodeProjectHead(row);
}
