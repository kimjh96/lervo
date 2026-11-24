import type { ProjectStorage } from "@lervo/project-storage";
import {
  clearCurrentWorkstreamProjection,
  readCurrentWorkstreamState,
  restoreCurrentWorkstreamState,
  sha256,
} from "@lervo/repository-knowledge";
import type { WorkstreamSnapshot } from "@lervo/schemas";

import { selectBranchWorkstream } from "./workstream-branch-selection.js";

function artifactUri(contentHash: string): string {
  return `lervo-cas://sha256/${contentHash.slice("sha256:".length)}`;
}

const WORKSTREAM_SNAPSHOT_TYPES = ["workstream.snapshot.recorded"] as const;

/**
 * Workstream snapshot events in sequence order, read through the store's type index. Every prompt
 * resolves the current workstream, so decoding the whole event history here made each prompt slower
 * as the history grew.
 */
export function* workstreamSnapshotEvents(storage: Pick<ProjectStorage, "events">) {
  let afterSeq = 0;
  while (true) {
    const events = storage.events.list({ afterSeq, limit: 1000, types: WORKSTREAM_SNAPSHOT_TYPES });
    for (const event of events) {
      afterSeq = event.seq;
      // The store applies `types`; the check keeps a store that ignores it from answering wrongly.
      if (event.type === WORKSTREAM_SNAPSHOT_TYPES[0]) yield event;
    }
    if (events.length < 1000) return;
  }
}

function latestWorkstreamEvent(storage: ProjectStorage, workstreamId?: string) {
  let latest: ReturnType<ProjectStorage["events"]["list"]>[number] | null = null;
  for (const event of workstreamSnapshotEvents(storage))
    if (workstreamId === undefined || event.payload.workstreamId === workstreamId) latest = event;
  return latest;
}

function hasReplicatedWorkstreamOrigin(storage: ProjectStorage, workstreamId: string): boolean {
  for (const event of workstreamSnapshotEvents(storage)) {
    const payload = event.payload as Record<string, unknown>;
    if (payload.workstreamId === workstreamId && payload.changeKind === "hub_replication_import")
      return true;
  }
  return false;
}

async function restoreRecordedWorkstream(
  storage: ProjectStorage,
  event: NonNullable<ReturnType<typeof latestWorkstreamEvent>>,
) {
  const payload = event.payload as Record<string, unknown>;
  if (typeof payload.snapshotContentHash !== "string")
    throw new Error("The recorded workstream snapshot hash is invalid.");
  const uri = artifactUri(payload.snapshotContentHash);
  if (!(await storage.artifacts.has(uri)))
    throw new Error("The recorded workstream snapshot artifact is missing.");
  await restoreCurrentWorkstreamState({
    repositoryRoot: storage.paths.repositoryRoot,
    content: await storage.artifacts.get(uri),
    expectedHash: payload.snapshotContentHash,
  });
  const state = await readCurrentWorkstreamState(storage.paths.repositoryRoot);
  if (state === null)
    throw new Error("The recorded current workstream state could not be rebuilt.");
  return state;
}

/**
 * Verifies the workstream the checked-out branch continues. Switching branches re-projects that
 * branch's workstream from its recorded history; a branch that continues none selects nothing.
 */
export async function verifiedCurrentWorkstream(
  storage: ProjectStorage,
): Promise<WorkstreamSnapshot | null> {
  const root = storage.paths.repositoryRoot;
  let state = await readCurrentWorkstreamState(root);
  const selection = await selectBranchWorkstream({
    root,
    projected: state?.snapshot ?? null,
  });
  if (selection.kind === "unbound") {
    if (state !== null) await clearCurrentWorkstreamProjection(root);
    return null;
  }
  if (selection.kind === "bound" && state?.snapshot.workstreamId !== selection.workstreamId) {
    const bound = latestWorkstreamEvent(storage, selection.workstreamId);
    if (bound === null) {
      // The binding outlived its local history, as in a fresh clone before replication.
      if (state !== null) await clearCurrentWorkstreamProjection(root);
      return null;
    }
    state = await restoreRecordedWorkstream(storage, bound);
  }
  const event = latestWorkstreamEvent(storage, state?.snapshot.workstreamId);
  if (state === null) {
    if (event === null) return null;
    state = await restoreRecordedWorkstream(storage, event);
  }
  if (event === null) throw new Error("The current workstream has no committed snapshot event.");
  const payload = event.payload as Record<string, unknown>;
  if (
    payload.workstreamId !== state.snapshot.workstreamId ||
    payload.revision !== state.snapshot.revision ||
    payload.status !== state.snapshot.status ||
    payload.snapshotContentHash !== state.contentHash ||
    payload.snapshotArtifactId !== `art_${state.contentHash.slice("sha256:".length)}`
  ) {
    throw new Error("The current workstream differs from its latest committed event.");
  }
  const uri = artifactUri(state.contentHash);
  if (!(await storage.artifacts.has(uri)))
    throw new Error("The current workstream snapshot artifact is missing.");
  const artifact = await storage.artifacts.get(uri);
  if (
    sha256(artifact) !== state.contentHash ||
    !Buffer.from(artifact).equals(Buffer.from(state.content))
  ) {
    throw new Error("The current workstream snapshot artifact is invalid.");
  }
  if (state.snapshot.origin.sourceContentHash !== null) {
    if (
      state.snapshot.origin.sourceArtifactId !==
      `art_${state.snapshot.origin.sourceContentHash.slice("sha256:".length)}`
    ) {
      throw new Error("The current workstream origin coordinates are invalid.");
    }
    const sourceUri = artifactUri(state.snapshot.origin.sourceContentHash);
    const sourceExists = await storage.artifacts.has(sourceUri);
    if (!sourceExists && !hasReplicatedWorkstreamOrigin(storage, state.snapshot.workstreamId)) {
      throw new Error("The current workstream origin artifact is missing or invalid.");
    }
    if (
      sourceExists &&
      sha256(await storage.artifacts.get(sourceUri)) !== state.snapshot.origin.sourceContentHash
    ) {
      throw new Error("The current workstream origin artifact is missing or invalid.");
    }
  }
  return state.snapshot;
}
