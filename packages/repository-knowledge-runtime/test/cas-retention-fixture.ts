import { mkdtemp, realpath, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { FileSystemCas } from "@lervo/cas";
import {
  applyInitPlan,
  createInitPlan,
  loadProjectManifest,
  resolveProjectPaths,
} from "@lervo/project";
import type { ProjectStorage } from "@lervo/project-storage";
import type { EventEnvelope } from "@lervo/schemas";
import type { OutboxStore } from "@lervo/storage-contract";

export const oldDate = new Date("2026-01-01T00:00:00Z");
export async function retentionFixture() {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-cas-retention-")));
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_retention_fixture" }));
  const paths = resolveProjectPaths(root);
  const artifacts = await FileSystemCas.open(paths.cas);
  const history: EventEnvelope[] = [];
  const events = {
    latest: () => history.at(-1) ?? null,
    list: (options: { afterSeq?: number; limit?: number; types?: string[] } = {}) =>
      history
        .filter(
          (event) =>
            event.seq > (options.afterSeq ?? 0) &&
            (!options.types || options.types.includes(event.type)),
        )
        .slice(0, options.limit ?? 1000),
  } as unknown as OutboxStore;
  const storage: ProjectStorage = {
    paths,
    artifacts,
    events,
    manifest: await loadProjectManifest(root),
    writableEventSchemaVersion: 4,
    close: async () => {},
  };
  const put = async (value: unknown) => {
    const artifact = await artifacts.put(JSON.stringify(value));
    const hash = artifact.contentHash.slice(7);
    await utimes(resolve(paths.cas, "sha256", hash.slice(0, 2), hash.slice(2)), oldDate, oldDate);
    return artifact;
  };
  const event = (type: string, payload: Record<string, unknown>) => {
    if (type === "repository.knowledge.stage.recorded") {
      const predecessor = history.findLast(
        (event) =>
          event.payload.obligationId === payload.obligationId &&
          [
            "repository.knowledge.baseline.requested",
            "repository.knowledge.stage.recorded",
          ].includes(event.type),
      );
      if (!predecessor) throw new Error("The stage fixture needs a baseline.");
      payload = {
        predecessorEventId: predecessor.eventId,
        predecessorEventHash: predecessor.eventHash,
        ...payload,
      };
    }
    if (type === "repository.knowledge.convergence.recorded") {
      const baseline = history.find(
        (event) =>
          event.type === "repository.knowledge.baseline.requested" &&
          event.payload.obligationId === payload.obligationId,
      );
      if (!baseline) throw new Error("The terminal fixture needs a baseline.");
      payload = {
        originalEventId: baseline.eventId,
        originalEventHash: baseline.eventHash,
        ...payload,
      };
    }
    const seq = history.length + 1;
    const record = {
      type,
      payload,
      seq,
      projectId: storage.manifest.projectId,
      eventId: `evt_${String(seq).padStart(32, "0")}`,
      eventHash: `sha256:${String(seq).padStart(64, "0")}`,
      previousHash: history.at(-1)?.eventHash ?? null,
      occurredAt: oldDate.toISOString(),
    } as unknown as EventEnvelope;
    history.push(record);
    return record;
  };
  const settled = async (label: string, extraOld: string[] = []) => {
    const obsolete = await put({ label, kind: "obsolete" });
    const kept = await put({ label, kind: "settled" });
    event("repository.knowledge.baseline.requested", {
      obligationId: label,
      inputArtifactHash: obsolete.contentHash,
    });
    event("repository.knowledge.stage.recorded", {
      obligationId: label,
      stage: "assessment",
      state: "current",
      inputArtifactHash: obsolete.contentHash,
      resultArtifactHash: obsolete.contentHash,
    });
    for (const hash of extraOld)
      event("repository.knowledge.stage.recorded", {
        obligationId: label,
        stage: "canonical_review",
        state: "current",
        inputArtifactHash: hash,
        resultArtifactHash: hash,
      });
    event("repository.knowledge.stage.recorded", {
      obligationId: label,
      stage: "lifecycle_verification",
      state: "current",
      inputArtifactHash: kept.contentHash,
      resultArtifactHash: kept.contentHash,
    });
    event("repository.knowledge.convergence.recorded", {
      obligationId: label,
      terminalState: "current",
      lifecycleReceiptDigest: kept.contentHash,
    });
    return { obsolete, kept };
  };
  return {
    root,
    storage,
    artifacts,
    history,
    put,
    event,
    settled,
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

export async function finishRetention(storage: ProjectStorage) {
  const { compactProjectConvergenceArtifacts } = await import("../src/cas-retention.js");
  for (let cycle = 0; cycle < 128; cycle++) {
    const result = await compactProjectConvergenceArtifacts(storage);
    if (result === null || result.status !== "yielded") return result;
  }
  throw new Error("Reference scan did not complete within the fixture bound.");
}
