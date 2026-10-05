import { createHash } from "node:crypto";
import { type DatabaseSync } from "node:sqlite";

import { canonicalJson } from "@lervo/event-contract";
import { HubWorkstreamReplicationError } from "@lervo/hub-sync";
import {
  isWorkstreamSuccessorRoot,
  validateSchema,
  type ReplicatedWorkstreamHead,
  type WorkstreamReplicationPublishRequest,
  type WorkstreamReplicationPublishResponse,
  type WorkstreamReplicationReadResponse,
  type WorkstreamSnapshot,
} from "@lervo/schemas";

import { sqliteRow } from "./sqlite-row.js";

interface RevisionRow {
  snapshot_content_hash: string;
  previous_snapshot_content_hash: string | null;
  workstream_id: string;
  revision: number;
  status: WorkstreamSnapshot["status"];
  snapshot_json: string;
  published_at: string;
  is_head: number;
}

const MAX_HEADS = 16;

function snapshotJson(snapshot: WorkstreamSnapshot): string {
  return `${canonicalJson(snapshot)}\n`;
}

function contentHash(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function headOf(row: RevisionRow): ReplicatedWorkstreamHead {
  return {
    workstreamId: row.workstream_id,
    revision: row.revision,
    status: row.status,
    snapshotContentHash: row.snapshot_content_hash,
    previousSnapshotContentHash: row.previous_snapshot_content_hash,
    publishedAt: row.published_at,
  };
}

export class HubWorkstreamSQLiteRepository {
  constructor(private readonly database: DatabaseSync) {}

  publish(input: {
    destinationId: string;
    request: WorkstreamReplicationPublishRequest;
    publishedAt: string;
  }): WorkstreamReplicationPublishResponse {
    const { request } = input;
    const registration = this.database
      .prepare(
        `
      SELECT registration_id, identity_hash
      FROM hub_projects
      WHERE destination_id = ? AND project_id = ?
    `,
      )
      .get(input.destinationId, request.projectId) as
      { registration_id: string; identity_hash: string } | undefined;
    if (
      registration === undefined ||
      registration.registration_id !== request.registrationId ||
      registration.identity_hash !== request.repositoryIdentityHash
    ) {
      throw new HubWorkstreamReplicationError(
        "registration_required",
        "No registered project identity matches the workstream publication.",
      );
    }

    const serialized = snapshotJson(request.snapshot);
    if (contentHash(serialized) !== request.snapshotContentHash) {
      throw new HubWorkstreamReplicationError(
        "invalid_workstream",
        "The workstream snapshot content hash is invalid.",
      );
    }
    const existing = this.revision(
      request.projectId,
      request.repositoryIdentityHash,
      request.snapshotContentHash,
    );
    if (existing !== undefined) {
      if (
        existing.previous_snapshot_content_hash !== request.previousSnapshotContentHash ||
        existing.snapshot_json !== serialized
      ) {
        throw new HubWorkstreamReplicationError(
          "workstream_conflict",
          "The workstream snapshot hash is already bound to different bytes or ancestry.",
        );
      }
      return this.response("duplicate", request.projectId, request.repositoryIdentityHash);
    }

    const total = this.countRevisions(request.projectId, request.repositoryIdentityHash);
    let parent: RevisionRow | undefined;
    if (request.previousSnapshotContentHash === null) {
      if (request.snapshot.revision !== 1 || request.snapshot.origin.kind === "successor") {
        throw new HubWorkstreamReplicationError(
          "unknown_parent",
          "A root workstream snapshot must be revision 1.",
        );
      }
    } else {
      parent = this.revision(
        request.projectId,
        request.repositoryIdentityHash,
        request.previousSnapshotContentHash,
      );
      if (parent === undefined) {
        throw new HubWorkstreamReplicationError(
          "unknown_parent",
          "The preceding workstream snapshot must be published first.",
        );
      }
      const parentSnapshot = JSON.parse(parent.snapshot_json) as WorkstreamSnapshot;
      const sameWorkstream =
        parent.workstream_id === request.snapshot.workstreamId &&
        request.snapshot.revision === parent.revision + 1 &&
        canonicalJson(parentSnapshot.origin) === canonicalJson(request.snapshot.origin);
      const nextWorkstream =
        parent.is_head === 1 &&
        isWorkstreamSuccessorRoot(request.snapshot, {
          ...parentSnapshot,
          snapshotContentHash: request.previousSnapshotContentHash,
        });
      if (!sameWorkstream && !nextWorkstream) {
        throw new HubWorkstreamReplicationError(
          "workstream_conflict",
          "A workstream revision must continue its identity or exactly succeed a settled head.",
        );
      }
    }

    const currentHeads = this.heads(request.projectId, request.repositoryIdentityHash);
    const replacesHead = parent?.is_head === 1;
    const nextHeadCount = currentHeads.length + 1 - (replacesHead ? 1 : 0);
    if (nextHeadCount > MAX_HEADS) {
      throw new HubWorkstreamReplicationError(
        "head_limit_exceeded",
        `A repository identity may retain at most ${MAX_HEADS} divergent workstream heads.`,
      );
    }
    if (replacesHead) {
      this.database
        .prepare(
          `
        UPDATE hub_workstream_revisions SET is_head = 0
        WHERE project_id = ? AND repository_identity_hash = ?
          AND snapshot_content_hash = ? AND is_head = 1
      `,
        )
        .run(
          request.projectId,
          request.repositoryIdentityHash,
          request.previousSnapshotContentHash,
        );
    }
    this.database
      .prepare(
        `
      INSERT INTO hub_workstream_revisions (
        project_id, repository_identity_hash,
        snapshot_content_hash, previous_snapshot_content_hash,
        workstream_id, revision, status, snapshot_json, published_at, is_head
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `,
      )
      .run(
        request.projectId,
        request.repositoryIdentityHash,
        request.snapshotContentHash,
        request.previousSnapshotContentHash,
        request.snapshot.workstreamId,
        request.snapshot.revision,
        request.snapshot.status,
        serialized,
        input.publishedAt,
      );
    const status = total === 0 ? "created" : nextHeadCount > 1 ? "divergent" : "fast_forwarded";
    return this.response(status, request.projectId, request.repositoryIdentityHash);
  }

  read(input: {
    destinationId: string;
    projectId: string;
    repositoryIdentityHash: string;
  }): WorkstreamReplicationReadResponse {
    const registration = this.database
      .prepare(
        `
      SELECT identity_hash FROM hub_projects
      WHERE destination_id = ? AND project_id = ?
    `,
      )
      .get(input.destinationId, input.projectId) as { identity_hash: string } | undefined;
    if (registration === undefined || registration.identity_hash !== input.repositoryIdentityHash) {
      throw new HubWorkstreamReplicationError(
        "registration_required",
        "No registered project identity matches the workstream query.",
      );
    }
    const heads = this.heads(input.projectId, input.repositoryIdentityHash);
    if (heads.length === 0) {
      return {
        schemaVersion: 1,
        status: "not_found",
        projectId: input.projectId,
        repositoryIdentityHash: input.repositoryIdentityHash,
        heads: [],
        snapshot: null,
      };
    }
    if (heads.length > 1) {
      return {
        schemaVersion: 1,
        status: "divergent",
        projectId: input.projectId,
        repositoryIdentityHash: input.repositoryIdentityHash,
        heads: heads.map(headOf),
        snapshot: null,
      };
    }
    const snapshot = JSON.parse(heads[0]!.snapshot_json) as unknown;
    if (!validateSchema("workstreamSnapshot", snapshot).valid) {
      throw new HubWorkstreamReplicationError(
        "workstream_conflict",
        "The stored workstream snapshot is invalid.",
      );
    }
    return {
      schemaVersion: 1,
      status: "current",
      projectId: input.projectId,
      repositoryIdentityHash: input.repositoryIdentityHash,
      heads: [headOf(heads[0]!)],
      snapshot: snapshot as WorkstreamSnapshot,
    };
  }

  auditAll(): void {
    const rows = this.database
      .prepare(
        `
      SELECT project_id, repository_identity_hash, snapshot_content_hash,
        previous_snapshot_content_hash, workstream_id, revision, status,
        snapshot_json, published_at, is_head
      FROM hub_workstream_revisions
      ORDER BY project_id, repository_identity_hash, revision, snapshot_content_hash
    `,
      )
      .all() as unknown as Array<
      RevisionRow & { project_id: string; repository_identity_hash: string }
    >;
    const rowByKey = new Map(
      rows.map((row) => [
        `${row.project_id}\0${row.repository_identity_hash}\0${row.snapshot_content_hash}`,
        row,
      ]),
    );
    const parentsWithChildren = new Set(
      rows
        .filter((row) => row.previous_snapshot_content_hash !== null)
        .map(
          (row) =>
            `${row.project_id}\0${row.repository_identity_hash}\0${row.previous_snapshot_content_hash}`,
        ),
    );
    const headCounts = new Map<string, number>();
    for (const row of rows) {
      const snapshot = JSON.parse(row.snapshot_json) as unknown;
      if (!validateSchema("workstreamSnapshot", snapshot).valid) {
        throw new Error("A stored Hub workstream snapshot is invalid.");
      }
      const typed = snapshot as WorkstreamSnapshot;
      const key = `${row.project_id}\0${row.repository_identity_hash}\0${row.snapshot_content_hash}`;
      const expectedHead = parentsWithChildren.has(key) ? 0 : 1;
      const registration = this.database
        .prepare(
          `
        SELECT 1 FROM hub_projects WHERE project_id = ? AND identity_hash = ? LIMIT 1
      `,
        )
        .get(row.project_id, row.repository_identity_hash);
      if (
        registration === undefined ||
        contentHash(row.snapshot_json) !== row.snapshot_content_hash ||
        typed.workstreamId !== row.workstream_id ||
        typed.revision !== row.revision ||
        typed.status !== row.status ||
        row.is_head !== expectedHead ||
        !Number.isFinite(Date.parse(row.published_at))
      )
        throw new Error("A stored Hub workstream revision binding is invalid.");
      if (row.previous_snapshot_content_hash === null) {
        if (row.revision !== 1) throw new Error("A Hub workstream root revision is invalid.");
      } else {
        const parentKey = `${row.project_id}\0${row.repository_identity_hash}\0${row.previous_snapshot_content_hash}`;
        const parent = rowByKey.get(parentKey);
        if (parent === undefined) throw new Error("A Hub workstream parent revision is missing.");
        const parentSnapshot = JSON.parse(parent.snapshot_json) as WorkstreamSnapshot;
        const sameWorkstream =
          parent.workstream_id === row.workstream_id &&
          parent.revision + 1 === row.revision &&
          canonicalJson(parentSnapshot.origin) === canonicalJson(typed.origin);
        // ADR-0199: a successor root links the exact settled predecessor head instead of a prior
        // revision of its own identity, so its parent is a different workstream. Publication also
        // required that head to be current, which the successor then replaces; head position is a
        // publication precondition and not a property the stored ancestry keeps.
        const nextWorkstream = isWorkstreamSuccessorRoot(typed, {
          ...parentSnapshot,
          snapshotContentHash: parent.snapshot_content_hash,
        });
        if (!sameWorkstream && !nextWorkstream)
          throw new Error("A Hub workstream ancestry binding is invalid.");
      }
      if (row.is_head === 1) {
        const group = `${row.project_id}\0${row.repository_identity_hash}`;
        headCounts.set(group, (headCounts.get(group) ?? 0) + 1);
      }
    }
    if ([...headCounts.values()].some((count) => count < 1 || count > MAX_HEADS)) {
      throw new Error("A Hub workstream head set is invalid.");
    }
  }

  private response(
    status: WorkstreamReplicationPublishResponse["status"],
    projectId: string,
    identityHash: string,
  ): WorkstreamReplicationPublishResponse {
    return {
      schemaVersion: 1,
      status,
      projectId,
      repositoryIdentityHash: identityHash,
      heads: this.heads(projectId, identityHash).map(headOf),
    };
  }

  private revision(projectId: string, identityHash: string, hash: string): RevisionRow | undefined {
    return this.database
      .prepare(
        `
      SELECT snapshot_content_hash, previous_snapshot_content_hash, workstream_id,
        revision, status, snapshot_json, published_at, is_head
      FROM hub_workstream_revisions
      WHERE project_id = ? AND repository_identity_hash = ?
        AND snapshot_content_hash = ?
    `,
      )
      .get(projectId, identityHash, hash) as RevisionRow | undefined;
  }

  private heads(projectId: string, identityHash: string): RevisionRow[] {
    return this.database
      .prepare(
        `
      SELECT snapshot_content_hash, previous_snapshot_content_hash, workstream_id,
        revision, status, snapshot_json, published_at, is_head
      FROM hub_workstream_revisions
      WHERE project_id = ? AND repository_identity_hash = ? AND is_head = 1
      ORDER BY revision DESC, snapshot_content_hash ASC
      LIMIT ${MAX_HEADS + 1}
    `,
      )
      .all(projectId, identityHash) as unknown as RevisionRow[];
  }

  private countRevisions(projectId: string, identityHash: string): number {
    const value = sqliteRow(
      this.database
        .prepare(
          `
      SELECT COUNT(*) AS count FROM hub_workstream_revisions
      WHERE project_id = ? AND repository_identity_hash = ?
    `,
        )
        .get(projectId, identityHash),
    )?.count;
    if (typeof value !== "number") {
      throw new HubWorkstreamReplicationError(
        "workstream_conflict",
        "The workstream revision count is invalid.",
      );
    }
    return value;
  }
}
