import { canonicalJson } from "@lervo/event-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge";
import { validateSchema, type EventEnvelope, type WorkstreamSnapshot } from "@lervo/schemas";
import { collectEventsOfTypesBounded } from "@lervo/storage-contract";

import { readSupervisionTextArtifact } from "./supervision-artifact-json.js";

/** Snapshot events one read may retain; the length of the whole history is never bounded. */
const maximumSnapshotEvents = 100_000;

export interface BoundWorkstreamState {
  snapshot: WorkstreamSnapshot;
  content: string;
  contentHash: string;
  sourceEventId: string;
  sourceEventHash: string;
}

/**
 * Selects one canonical goal by reviewed binding, never by the human-facing current pointer.
 * Only snapshot events decide the answer, so without verified events it reads that type alone;
 * each returned row is hash-checked and the snapshot chain itself is validated below.
 */
export async function readBoundWorkstreamState(
  storage: ProjectStorage,
  workstreamId: string,
  verifiedEvents?: readonly EventEnvelope[],
): Promise<BoundWorkstreamState | null> {
  if (!/^wks_[a-f0-9]{24}$/u.test(workstreamId))
    throw new Error("The bound workstream identity is invalid.");
  const events =
    verifiedEvents ??
    collectEventsOfTypesBounded({
      events: storage.events,
      types: ["workstream.snapshot.recorded"],
      maximumEvents: maximumSnapshotEvents,
    });
  const snapshots = events.filter(
    (event) =>
      event.type === "workstream.snapshot.recorded" &&
      event.projectId === storage.manifest.projectId &&
      event.payload.workstreamId === workstreamId,
  );
  if (snapshots.length === 0) return null;
  let previousHash: string | null = null;
  let previousRevision = 0;
  let firstPredecessorHash: unknown = null;
  let firstRevision = 0;
  for (const event of snapshots) {
    const revision =
      typeof event.payload.revision === "number" ? event.payload.revision : Number.NaN;
    const hash = event.payload.snapshotContentHash;
    if (previousRevision === 0) {
      firstRevision = revision;
      firstPredecessorHash = event.payload.previousSnapshotContentHash;
    }
    const importedGap =
      revision > previousRevision + 1 &&
      event.payload.changeKind === "hub_replication_import" &&
      typeof event.payload.previousSnapshotContentHash === "string" &&
      /^sha256:[a-f0-9]{64}$/u.test(event.payload.previousSnapshotContentHash);
    if (
      !Number.isSafeInteger(revision) ||
      (revision !== previousRevision + 1 && !importedGap) ||
      typeof hash !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(hash) ||
      (previousRevision > 0 &&
        !importedGap &&
        event.payload.previousSnapshotContentHash !== previousHash) ||
      event.payload.snapshotArtifactId !== `art_${hash.slice(7)}`
    )
      throw new Error("The bound workstream snapshot history is forked or incomplete.");
    // Hub replication transfers an exact head, not every intervening revision. Verify the
    // imported checkpoint itself before allowing later local revisions to extend it.
    if (importedGap) {
      const imported = await readSupervisionTextArtifact(storage.artifacts, hash);
      if (Buffer.byteLength(imported) > 64 * 1024)
        throw new Error("The imported workstream snapshot exceeds its byte bound.");
      let value: unknown;
      try {
        value = JSON.parse(imported);
      } catch (error) {
        throw new Error("The imported workstream snapshot is not valid JSON.", { cause: error });
      }
      if (
        !validateSchema("workstreamSnapshot", value).valid ||
        `${canonicalJson(value)}\n` !== imported ||
        (value as WorkstreamSnapshot).workstreamId !== workstreamId ||
        (value as WorkstreamSnapshot).revision !== revision ||
        (value as WorkstreamSnapshot).status !== event.payload.status
      )
        throw new Error("The imported workstream snapshot differs from its event.");
    }
    previousRevision = revision;
    previousHash = hash;
  }
  const latest = snapshots.at(-1)!;
  const contentHash = String(latest.payload.snapshotContentHash);
  const content = await readSupervisionTextArtifact(storage.artifacts, contentHash);
  if (Buffer.byteLength(content) > 64 * 1024)
    throw new Error("The bound workstream snapshot exceeds its byte bound.");
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new Error("The bound workstream snapshot is not valid JSON.", { cause: error });
  }
  if (!validateSchema("workstreamSnapshot", value).valid || `${canonicalJson(value)}\n` !== content)
    throw new Error("The bound workstream snapshot is not canonical.");
  const snapshot = value as WorkstreamSnapshot;
  if (
    snapshot.workstreamId !== workstreamId ||
    snapshot.revision !== latest.payload.revision ||
    snapshot.status !== latest.payload.status ||
    (firstRevision === 1 &&
      firstPredecessorHash !==
        (snapshot.origin.kind === "successor"
          ? snapshot.origin.predecessorSnapshotContentHash
          : null))
  )
    throw new Error("The bound workstream snapshot differs from its event.");
  const selected = await readCurrentWorkstreamState(storage.paths.repositoryRoot);
  if (selected?.snapshot.workstreamId === workstreamId && selected.contentHash !== contentHash)
    throw new Error("The selected workstream projection differs from canonical history.");
  return {
    snapshot,
    content,
    contentHash,
    sourceEventId: latest.eventId,
    sourceEventHash: latest.eventHash,
  };
}
