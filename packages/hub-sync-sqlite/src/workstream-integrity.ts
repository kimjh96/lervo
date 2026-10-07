import type { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "@lervo/event-contract";
import {
  isWorkstreamSuccessorRoot,
  validateSchema,
  workstreamReconciliationPredecessors,
  type WorkstreamSnapshot,
} from "@lervo/schemas";
import { contentHash, MAX_WORKSTREAM_HEADS, type RevisionRow } from "./workstream-revision.js";

export function auditHubWorkstreams(database: DatabaseSync): void {
  const rows = database
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
    rows.flatMap((row) => {
      const snapshot = JSON.parse(row.snapshot_json) as WorkstreamSnapshot;
      const parents = row.revision === 1 ? workstreamReconciliationPredecessors(snapshot) : null;
      const hashes =
        parents?.map((parent) => parent.snapshotContentHash) ??
        (row.previous_snapshot_content_hash === null ? [] : [row.previous_snapshot_content_hash]);
      return hashes.map((hash) => `${row.project_id}\0${row.repository_identity_hash}\0${hash}`);
    }),
  );
  const headCounts = new Map<string, number>();
  for (const row of rows) {
    const snapshot = JSON.parse(row.snapshot_json) as unknown;
    if (!validateSchema("workstreamSnapshot", snapshot).valid) {
      throw new Error("A stored Hub workstream snapshot is invalid.");
    }
    const typed = snapshot as WorkstreamSnapshot;
    if (typed.origin.reconciliationPredecessors !== undefined) {
      const parents = workstreamReconciliationPredecessors(typed);
      if (
        parents === null ||
        parents.some((parent) => {
          const predecessor = rowByKey.get(
            `${row.project_id}\0${row.repository_identity_hash}\0${parent.snapshotContentHash}`,
          );
          return (
            predecessor === undefined ||
            predecessor.workstream_id !== parent.workstreamId ||
            predecessor.workstream_id === typed.workstreamId
          );
        })
      )
        throw new Error("A stored workstream reconciliation binding is invalid.");
      if (
        row.revision === 1 &&
        row.previous_snapshot_content_hash !== typed.origin.predecessorSnapshotContentHash
      )
        throw new Error("A stored workstream reconciliation parent is invalid.");
    }
    const key = `${row.project_id}\0${row.repository_identity_hash}\0${row.snapshot_content_hash}`;
    const expectedHead = parentsWithChildren.has(key) ? 0 : 1;
    const registration = database
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
  if ([...headCounts.values()].some((count) => count < 1 || count > MAX_WORKSTREAM_HEADS)) {
    throw new Error("A Hub workstream head set is invalid.");
  }
}
