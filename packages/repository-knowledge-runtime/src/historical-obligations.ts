import {
  sha256,
  type KnowledgeConvergenceBaseline,
  type KnowledgeConvergenceInput,
} from "@lervo/repository-knowledge";
import type { ArtifactStore, OutboxStore } from "@lervo/storage-contract";

import { KnowledgeConvergenceRuntimeError } from "./failure.js";

async function changedPathsForEvent(
  payload: Record<string, unknown>,
  artifacts: ArtifactStore,
): Promise<string[]> {
  const count = payload.changedPathCount;
  const published = payload.changedPaths;
  if (
    !Number.isSafeInteger(count) ||
    (count as number) < 0 ||
    (count as number) > 20_000 ||
    !Array.isArray(published)
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_invalid");
  let paths: unknown[] = published;
  if (published.length === 0 && count !== 0) {
    const manifest = payload.sourceManifest as { contentHash?: string; byteCount?: number } | null;
    if (
      !manifest?.contentHash?.match(/^sha256:[a-f0-9]{64}$/u) ||
      !Number.isSafeInteger(manifest.byteCount) ||
      manifest.byteCount! > 1_048_576
    )
      throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_invalid");
    const bytes = await artifacts.get(`lervo-cas://sha256/${manifest.contentHash.slice(7)}`);
    if (bytes.byteLength !== manifest.byteCount || sha256(bytes) !== manifest.contentHash)
      throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_invalid");
    let document: { kind?: string; sourceEventId?: string; paths?: { path?: unknown }[] };
    try {
      document = JSON.parse(
        new TextDecoder("utf8", { fatal: true }).decode(bytes),
      ) as typeof document;
    } catch (error) {
      throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_invalid", { cause: error });
    }
    if (
      document.kind !== "repository.change.source_manifest" ||
      document.sourceEventId !== payload.sourceEventId ||
      !Array.isArray(document.paths) ||
      document.paths.some((entry) => entry === null || typeof entry !== "object")
    )
      throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_invalid");
    paths = document.paths.map((entry) => entry.path);
  }
  if (
    paths.length !== count ||
    paths.some(
      (path) =>
        typeof path !== "string" ||
        path.length === 0 ||
        path.startsWith("/") ||
        path.includes("\\") ||
        path.split("/").some((part: string) => part === "" || part === "." || part === ".."),
    )
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_invalid");
  return paths as string[];
}

/** Old attention outcomes and dropped queue admissions stay visible until a later baseline covers them. */
export async function historicalObligations(
  events: OutboxStore,
  artifacts: ArtifactStore,
): Promise<{ events: KnowledgeConvergenceBaseline["historicalEvents"]; paths: string[] }> {
  const changes = new Map<
    string,
    { eventId: string; eventHash: string; failureCode: string | null; paths: string[] }
  >();
  let afterSeq = 0;
  for (;;) {
    const page = events.list({ afterSeq, limit: 1_000 });
    if (page.length === 0) break;
    for (const event of page) {
      afterSeq = event.seq;
      if (event.type === "repository.change.completed")
        changes.set(event.eventId, {
          eventId: event.eventId,
          eventHash: event.eventHash,
          failureCode: "knowledge_continuation_missing",
          paths: await changedPathsForEvent(event.payload, artifacts),
        });
      if (event.type === "repository.knowledge.resolved") {
        const id = event.payload.changeEventId as string;
        if (event.payload.terminalState === "current") changes.delete(id);
        else
          changes.set(id, {
            eventId: event.eventId,
            eventHash: event.eventHash,
            failureCode:
              (event.payload.failureCode as string | null) ?? "canonicalization_candidate_missing",
            paths: changes.get(id)?.paths ?? [],
          });
      }
      if (changes.size > 20_000)
        throw new KnowledgeConvergenceRuntimeError("knowledge_capacity_unavailable");
      if (
        event.type === "repository.knowledge.convergence.recorded" &&
        event.payload.terminalState === "current"
      ) {
        const hash = event.payload.lifecycleReceiptDigest as string;
        const bytes = await artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`);
        if (sha256(bytes) !== hash)
          throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_invalid");
        const receipt = JSON.parse(
          new TextDecoder("utf8", { fatal: true }).decode(bytes),
        ) as KnowledgeConvergenceInput;
        if (
          receipt.obligationId !== event.payload.obligationId ||
          receipt.baseline.projectId !== event.projectId
        )
          throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_invalid");
        const covered = new Map(
          receipt.baseline.historicalEvents.map((source) => [source.eventId, source.eventHash]),
        );
        for (const [id, source] of changes)
          if (covered.get(source.eventId) === source.eventHash) changes.delete(id);
      }
    }
  }
  // A live generic source has a durable queue owner; completed attention remains baseline debt.
  const outstanding = [...changes.entries()]
    .filter(
      ([id, source]) =>
        source.eventId !== id || events.getOutbox(id, "knowledge:repository") === null,
    )
    .map(([, source]) => source);
  return {
    events: outstanding.map(({ paths: _paths, ...source }) => source),
    paths: [...new Set(outstanding.flatMap((source) => source.paths))].sort(),
  };
}
