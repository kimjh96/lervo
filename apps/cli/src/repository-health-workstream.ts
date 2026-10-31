import type { ProjectStorage } from "@lervo/project-storage";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge";
import type { WorkstreamSnapshot } from "@lervo/schemas";

/** Bounded observation only: missing state or provenance is unknown and never invokes recovery. */
export async function readHealthWorkstream(storage: ProjectStorage): Promise<{
  snapshot: WorkstreamSnapshot | null;
  coverage: "current" | "missing" | "unavailable";
}> {
  try {
    const state = await readCurrentWorkstreamState(storage.paths.repositoryRoot);
    if (state === null) return { snapshot: null, coverage: "unavailable" };
    let afterSeq = 0;
    let scanned = 0;
    let latest: ReturnType<ProjectStorage["events"]["list"]>[number] | undefined;
    let replicated = false;
    while (scanned <= 10_000) {
      const page = storage.events.list({
        afterSeq,
        limit: Math.min(1000, 10_001 - scanned),
        types: ["workstream.snapshot.recorded"],
      });
      if (page.length === 0) break;
      for (const event of page) {
        if (event.seq <= afterSeq) throw new Error("Workstream provenance did not advance.");
        afterSeq = event.seq;
        scanned++;
        if (event.payload.workstreamId === state.snapshot.workstreamId) {
          latest = event;
          if (event.payload.changeKind === "hub_replication_import") replicated = true;
        }
      }
    }
    const p = latest?.payload;
    if (
      scanned > 10_000 ||
      !p ||
      p.revision !== state.snapshot.revision ||
      p.status !== state.snapshot.status ||
      p.snapshotContentHash !== state.contentHash ||
      p.snapshotArtifactId !== `art_${state.contentHash.slice(7)}` ||
      !(await storage.artifacts.has(`lervo-cas://sha256/${state.contentHash.slice(7)}`))
    )
      throw new Error("Workstream provenance unavailable.");
    const origin = state.snapshot.origin;
    if (
      origin.sourceContentHash !== null &&
      (origin.sourceArtifactId !== `art_${origin.sourceContentHash.slice(7)}` ||
        (!replicated &&
          !(await storage.artifacts.has(
            `lervo-cas://sha256/${origin.sourceContentHash.slice(7)}`,
          ))))
    )
      throw new Error("Workstream origin unavailable.");
    return { snapshot: state.snapshot, coverage: "current" };
  } catch {
    return { snapshot: null, coverage: "unavailable" };
  }
}
