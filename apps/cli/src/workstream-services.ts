import type { ProjectStorage } from "@lervo/project-storage";
import {
  readCurrentWorkstreamState,
  restoreCurrentWorkstreamState,
  sha256,
} from "@lervo/repository-knowledge";
import type { WorkstreamSnapshot } from "@lervo/schemas";

function artifactUri(contentHash: string): string {
  return `lervo-cas://sha256/${contentHash.slice("sha256:".length)}`;
}

function latestWorkstreamEvent(storage: ProjectStorage) {
  let afterSeq = 0;
  let latest: ReturnType<ProjectStorage["events"]["list"]>[number] | null = null;
  while (true) {
    const events = storage.events.list({ afterSeq, limit: 1000 });
    if (events.length === 0) break;
    for (const event of events) {
      afterSeq = event.seq;
      if (event.type === "workstream.snapshot.recorded") latest = event;
    }
    if (events.length < 1000) break;
  }
  return latest;
}

function hasReplicatedWorkstreamOrigin(storage: ProjectStorage, workstreamId: string): boolean {
  let afterSeq = 0;
  while (true) {
    const events = storage.events.list({ afterSeq, limit: 1000 });
    if (events.length === 0) return false;
    for (const event of events) {
      afterSeq = event.seq;
      const payload = event.payload as Record<string, unknown>;
      if (
        event.type === "workstream.snapshot.recorded" &&
        payload.workstreamId === workstreamId &&
        payload.changeKind === "hub_replication_import"
      )
        return true;
    }
    if (events.length < 1000) return false;
  }
}

export async function verifiedCurrentWorkstream(
  storage: ProjectStorage,
): Promise<WorkstreamSnapshot | null> {
  let state = await readCurrentWorkstreamState(storage.paths.repositoryRoot);
  const event = latestWorkstreamEvent(storage);
  if (state === null) {
    if (event === null) return null;
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
    state = await readCurrentWorkstreamState(storage.paths.repositoryRoot);
    if (state === null)
      throw new Error("The recorded current workstream state could not be rebuilt.");
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
