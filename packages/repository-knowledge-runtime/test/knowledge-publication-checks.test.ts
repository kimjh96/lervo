import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  knowledgePublicationChecksDetail,
  knowledgePublicationChecksWaiting,
  knowledgePublicationInventoryKey,
  nextChecksRetry,
  rerunnableRunIds,
} from "../src/knowledge-publication-checks.js";
import type { KnowledgePublicationCheckFailure } from "../src/knowledge-publication-forge.js";
import { parseKnowledgePublicationSettings } from "../src/knowledge-publication-settings.js";
import {
  KNOWLEDGE_PUBLICATION_STATE_PATH,
  knowledgePublicationChecksBackoff,
  readKnowledgePublicationState,
  type KnowledgePublicationState,
} from "../src/knowledge-publication-state.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const HEAD = "a".repeat(40);
const failure = (
  name: string,
  conclusion: string,
  runId: number | null = null,
  kind: KnowledgePublicationCheckFailure["kind"] = "check_run",
): KnowledgePublicationCheckFailure => ({
  name,
  kind,
  conclusion,
  runId,
  jobId: runId === null ? null : runId * 10,
});

describe("publication check settings (ADR-0596)", () => {
  const target = {
    remote: "origin",
    baseBranch: "main",
    branch: "lervo/knowledge-outputs",
    merge: "when_checks_pass",
    scope: "delegation",
  };

  it("accepts exact names and refuses anything else", () => {
    expect(
      parseKnowledgePublicationSettings({
        ...target,
        checks: { ignore: ["Vercel – shiflo-web-next", "Vercel – shiflo-site-web"] },
      }),
    ).toMatchObject({
      checks: { ignore: ["Vercel – shiflo-web-next", "Vercel – shiflo-site-web"] },
    });
    expect(parseKnowledgePublicationSettings(target)).not.toHaveProperty("checks");
    for (const checks of [
      null,
      [],
      {},
      { ignore: [] },
      { ignore: [""] },
      { ignore: [" padded"] },
      { ignore: ["padded "] },
      { ignore: ["bell\u0007"] },
      { ignore: ["x".repeat(101)] },
      { ignore: ["same", "same"] },
      { ignore: Array.from({ length: 9 }, (_, index) => `check ${index}`) },
      { ignore: ["a"], extra: true },
    ])
      expect(parseKnowledgePublicationSettings({ ...target, checks })).toBeNull();
  });
});

describe("publication check retries (ADR-0596)", () => {
  it("waits 15 minutes, then 1 hour, then 6 hours at most", () => {
    expect([1, 2, 3, 9].map(knowledgePublicationChecksBackoff)).toEqual([
      15 * 60_000,
      60 * 60_000,
      6 * 60 * 60_000,
      6 * 60 * 60_000,
    ]);
    const now = new Date("2026-11-20T00:00:00.000Z");
    const key = knowledgePublicationInventoryKey({ base: HEAD, knowledge: [] });
    const first = nextChecksRetry({
      current: undefined,
      head: HEAD,
      inventoryKey: key,
      rerun: false,
      now,
    });
    expect(first).toEqual({
      head: HEAD,
      inventoryKey: key,
      attempts: 1,
      retryAt: "2026-11-20T00:15:00.000Z",
      rerun: false,
    });
    const rerun = nextChecksRetry({
      current: first,
      head: HEAD,
      inventoryKey: key,
      rerun: true,
      now,
    });
    expect(rerun).toMatchObject({ attempts: 0, rerun: true, retryAt: now.toISOString() });
    expect(
      nextChecksRetry({ current: rerun, head: HEAD, inventoryKey: key, rerun: false, now }),
    ).toMatchObject({ attempts: 1, rerun: true });
  });

  it("reruns only Actions jobs that never ran or did not finish, each run once", () => {
    expect(
      rerunnableRunIds([
        failure("lint", "not_run", 1),
        failure("lint again", "not_run", 1),
        failure("title", "cancelled", 2),
        failure("slow", "timed_out", 3),
        failure("test", "failure", 4),
        failure("no run", "not_run", null),
        failure("preview", "failure", null, "status"),
      ]),
    ).toEqual([1, 2, 3]);
  });

  it("names failed checks in a bounded detail", () => {
    expect(
      knowledgePublicationChecksDetail({ state: "failed", total: 3, failed: 1, failures: [] }),
    ).toBe("1 of 3 checks failed");
    expect(
      knowledgePublicationChecksDetail({
        state: "failed",
        total: 12,
        failed: 10,
        failures: [failure("lint", "not_run", 1), failure("preview", "failure", null, "status")],
      }),
    ).toBe("10 of 12 checks failed: lint (not_run); preview (failure); 8 more");
    const long = knowledgePublicationChecksDetail({
      state: "failed",
      total: 8,
      failed: 8,
      failures: Array.from({ length: 8 }, (_, index) => failure(`${index}`.repeat(100), "failure")),
    });
    expect(long.length).toBe(480);
    expect(long.endsWith("…")).toBe(true);
  });

  it("waits only for the same head, the same inventory, and an unexpired backoff", () => {
    const key = knowledgePublicationInventoryKey({
      base: HEAD,
      knowledge: [{ sha: "b".repeat(40) }] as never,
    });
    const now = new Date("2026-11-20T00:10:00.000Z");
    const state: KnowledgePublicationState = {
      schemaVersion: 1,
      status: "failed",
      pullRequestNumber: 1,
      pullRequestUrl: "https://github.invalid/pull/1",
      publishedHead: HEAD,
      commitCount: 1,
      updatedAt: "2026-11-20T00:00:00.000Z",
      failure: {
        code: "knowledge_publication_checks_failed",
        detail: "1 of 1 checks failed",
        firstObservedAt: "2026-11-20T00:00:00.000Z",
        lastObservedAt: "2026-11-20T00:00:00.000Z",
        occurrences: 1,
      },
      checksRetry: {
        head: HEAD,
        inventoryKey: key,
        attempts: 1,
        retryAt: "2026-11-20T00:15:00.000Z",
        rerun: true,
      },
    };
    expect(knowledgePublicationChecksWaiting(state, key, now)).toBe(true);
    expect(knowledgePublicationChecksWaiting(state, `sha256:${"0".repeat(64)}`, now)).toBe(false);
    expect(knowledgePublicationChecksWaiting(state, null, now)).toBe(false);
    expect(
      knowledgePublicationChecksWaiting(state, key, new Date("2026-11-20T00:15:00.000Z")),
    ).toBe(false);
    expect(
      knowledgePublicationChecksWaiting({ ...state, publishedHead: "c".repeat(40) }, key, now),
    ).toBe(false);
    expect(
      knowledgePublicationChecksWaiting(
        { ...state, failure: { ...state.failure!, code: "knowledge_publication_push_failed" } },
        key,
        now,
      ),
    ).toBe(false);
    expect(
      knowledgePublicationChecksWaiting({ ...state, status: "awaiting_checks" }, key, now),
    ).toBe(false);
  });

  it("drops an invalid retry record and keeps the rest of the state", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-publication-checks-"));
    directories.push(root);
    await mkdir(resolve(root, ".lervo/state/knowledge"), { recursive: true });
    await writeFile(
      resolve(root, KNOWLEDGE_PUBLICATION_STATE_PATH),
      JSON.stringify({
        schemaVersion: 1,
        status: "failed",
        pullRequestNumber: 3,
        pullRequestUrl: null,
        publishedHead: HEAD,
        commitCount: 1,
        updatedAt: "2026-11-20T00:00:00.000Z",
        failure: null,
        checksRetry: { head: HEAD, attempts: "many" },
      }),
    );
    const state = await readKnowledgePublicationState(root);
    expect(state).toMatchObject({ status: "failed", pullRequestNumber: 3 });
    expect(state).not.toHaveProperty("checksRetry");
  });
});
