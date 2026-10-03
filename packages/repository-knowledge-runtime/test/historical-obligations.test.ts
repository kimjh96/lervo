import { expect, it } from "vitest";
import { sha256 } from "@lervo/repository-knowledge";
import type { ArtifactStore, OutboxStore } from "@lervo/storage-contract";
import { historicalObligations } from "../src/historical-obligations.js";

function sourceFixture(manifestHash?: string) {
  const paths = Array.from({ length: 65 }, (_, index) => `src/${index}.ts`);
  const manifest = Buffer.from(
    JSON.stringify({
      kind: "repository.change.source_manifest",
      sourceEventId: "evt_source",
      paths: paths.map((path) => ({ path, before: null, after: sha256(path) })),
    }),
  );
  const events = [
    {
      seq: 1,
      type: "repository.change.completed",
      eventId: "evt_change",
      eventHash: "sha256:change",
      payload: {
        sourceEventId: "evt_source",
        changedPathCount: paths.length,
        changedPaths: [],
        sourceManifest: {
          contentHash: manifestHash ?? sha256(manifest),
          byteCount: manifest.byteLength,
        },
      },
    },
    {
      seq: 2,
      type: "repository.knowledge.resolved",
      eventId: "evt_resolution",
      eventHash: "sha256:resolution",
      payload: {
        changeEventId: "evt_change",
        terminalState: "attention_required",
        failureCode: "canonicalization_candidate_missing",
      },
    },
  ];
  return {
    paths,
    events: {
      list: ({ afterSeq }: { afterSeq: number }) => events.filter((event) => event.seq > afterSeq),
      getOutbox: () => null,
    } as unknown as OutboxStore,
    artifacts: {
      get: async () => manifest,
    } as unknown as ArtifactStore,
  };
}

it("recovers overflow paths from exact CAS and retains them after a noncurrent resolution", async () => {
  const fixture = sourceFixture();
  const result = await historicalObligations(fixture.events, fixture.artifacts);
  expect(result.paths).toEqual(fixture.paths.sort());
  expect(result.events).toEqual([
    {
      eventId: "evt_resolution",
      eventHash: "sha256:resolution",
      failureCode: "canonicalization_candidate_missing",
    },
  ]);
});

it("rejects an overflow manifest whose digest differs from the event binding", async () => {
  const fixture = sourceFixture(`sha256:${"0".repeat(64)}`);
  await expect(historicalObligations(fixture.events, fixture.artifacts)).rejects.toMatchObject({
    code: "knowledge_job_source_invalid",
  });
});
