import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { sha256 } from "@lervo/repository-knowledge";
import type { ArtifactStore, OutboxStore } from "@lervo/storage-contract";
import { historicalObligations } from "../src/historical-obligations.js";
import {
  HISTORY_ACCEPTANCE_PATH,
  historicalAcceptanceKey,
  loadHistoricalAcceptance,
} from "../src/historical-acceptance.js";

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

it("closes only exactly accepted historical obligations", async () => {
  const fixture = sourceFixture();
  const accepted = await historicalObligations(
    fixture.events,
    fixture.artifacts,
    new Set([
      historicalAcceptanceKey({ eventId: "evt_resolution", eventHash: "sha256:resolution" }),
    ]),
  );
  expect(accepted).toEqual({ events: [], paths: [] });
  const otherHash = await historicalObligations(
    fixture.events,
    fixture.artifacts,
    new Set([historicalAcceptanceKey({ eventId: "evt_resolution", eventHash: "sha256:other" })]),
  );
  expect(otherHash.events).toHaveLength(1);
});

it("fails closed for a malformed or foreign owner acceptance", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-history-acceptance-"));
  await mkdir(resolve(root, ".lervo/knowledge"), { recursive: true });
  expect(loadHistoricalAcceptance(root, "prj_test")).toBeNull();
  const decision = {
    schemaVersion: 1,
    projectId: "prj_test",
    disposition: "owner_accepted",
    decidedAt: "2026-10-03T06:00:00.000Z",
    rationale: "The owner accepted the current repository state as the knowledge baseline.",
    events: [{ eventId: "evt_resolution", eventHash: sha256("resolution") }],
  };
  await writeFile(resolve(root, HISTORY_ACCEPTANCE_PATH), JSON.stringify(decision));
  expect(loadHistoricalAcceptance(root, "prj_test")?.accepted.size).toBe(1);
  expect(() => loadHistoricalAcceptance(root, "prj_other")).toThrow(
    expect.objectContaining({ code: "knowledge_job_source_invalid" }),
  );
  await writeFile(
    resolve(root, HISTORY_ACCEPTANCE_PATH),
    JSON.stringify({ ...decision, disposition: "covered" }),
  );
  expect(() => loadHistoricalAcceptance(root, "prj_test")).toThrow(
    expect.objectContaining({ code: "knowledge_job_source_invalid" }),
  );
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});
