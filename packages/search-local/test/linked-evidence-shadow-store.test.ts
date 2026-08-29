import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertLinkedEvidenceShadowObservation,
  createLinkedEvidenceShadowObservation,
  LINKED_EVIDENCE_SHADOW_MAX_OBSERVATIONS,
  LocalLinkedEvidenceShadowStore,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("local linked-evidence shadow store", () => {
  it("writes one immutable owner-only privacy-bounded observation and reads it back", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-linked-shadow-"));
    roots.push(root);
    await mkdir(resolve(root, ".lervo"));
    const store = await LocalLinkedEvidenceShadowStore.open(root);
    const observation = createLinkedEvidenceShadowObservation({
      projectId: "prj_shadow",
      runId: "run_shadow",
      observedAt: "2026-08-28T00:00:00.000Z",
      engine: { id: "lexical", version: 1 },
      indexId: "sidx_shadow",
      sourceSnapshotId: `sha256:${"1".repeat(64)}`,
      selectionTransitionId: null,
      recommendationBatchId: "srb_shadow",
      resultSetHash: `sha256:${"2".repeat(64)}`,
      recommendationCount: 1,
      candidateCount: 1,
      retainedCount: 1,
      ignoredCount: 0,
      truncated: false,
      retainedByteCount: 12,
      projectionDigest: `sha256:${"3".repeat(64)}`,
      retained: [{ documentId: "doc_linked", contentHash: `sha256:${"4".repeat(64)}` }],
      status: "observed",
      failureCode: null,
    });

    await store.record(observation);
    await store.record(observation);

    const {
      policy: _policy,
      recordId: _recordId,
      schemaVersion: _schemaVersion,
      ...input
    } = observation;
    const conflicting = createLinkedEvidenceShadowObservation({
      ...input,
      observedAt: "2026-08-28T00:00:01.000Z",
    });
    await expect(store.record(conflicting)).rejects.toMatchObject({
      code: "observation_conflict",
    });
    expect(() =>
      assertLinkedEvidenceShadowObservation({
        ...observation,
        engine: { ...observation.engine, path: "docs/private.md" },
      } as typeof observation),
    ).toThrow(expect.objectContaining({ code: "observation_invalid" }));

    expect(LINKED_EVIDENCE_SHADOW_MAX_OBSERVATIONS).toBe(10_000);
    expect(await store.list()).toEqual([observation]);
    const path = resolve(
      root,
      ".lervo/state/search/linked-evidence-shadow",
      `${observation.recordId}.json`,
    );
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
    const serialized = await readFile(path, "utf8");
    for (const forbiddenKey of ["path", "prompt", "query", "provider", "body", "title", "link"]) {
      expect(serialized).not.toContain(`"${forbiddenKey}"`);
    }
  });
});
