import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { RepositoryKnowledgeError } from "@lervo/repository-knowledge";

import { cycleScopedConvergenceDiscovery } from "../src/baseline.js";
import { fixture } from "./fixture.js";

const scan = vi.hoisted(() => ({ concurrentChanges: 0, calls: 0 }));

vi.mock("@lervo/repository-knowledge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lervo/repository-knowledge")>();
  return {
    ...actual,
    scanCompleteConfiguredRepositoryKnowledge: async (
      ...args: Parameters<typeof actual.scanCompleteConfiguredRepositoryKnowledge>
    ) => {
      scan.calls += 1;
      if (scan.concurrentChanges > 0) {
        scan.concurrentChanges -= 1;
        throw new actual.RepositoryKnowledgeError(
          "source_bytes_changed",
          "The repository revision changed during the scan.",
        );
      }
      return actual.scanCompleteConfiguredRepositoryKnowledge(...args);
    },
  };
});

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  scan.concurrentChanges = 0;
  scan.calls = 0;
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

it("retries a discovery that a concurrent commit invalidated", { timeout: 60_000 }, async () => {
  const f = await fixture(true);
  fixtures.push(f);
  scan.concurrentChanges = 2;
  const baseline = await cycleScopedConvergenceDiscovery(f.root, f.events, f.artifacts)();
  expect(baseline.sourceSnapshotHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
  expect(scan.concurrentChanges).toBe(0);
});

it("stops retrying after a bounded number of concurrent changes", { timeout: 60_000 }, async () => {
  const f = await fixture(true);
  fixtures.push(f);
  scan.concurrentChanges = 5;
  await expect(
    cycleScopedConvergenceDiscovery(f.root, f.events, f.artifacts)(),
  ).rejects.toBeInstanceOf(RepositoryKnowledgeError);
  // Three attempts were made; the remaining simulated changes were never consumed.
  expect(scan.concurrentChanges).toBe(2);
});

it(
  "reuses the repository observation across appended events that change no repository byte",
  { timeout: 60_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    const discover = cycleScopedConvergenceDiscovery(f.root, f.events, f.artifacts);
    await discover();
    const afterFirst = scan.calls;
    const append = (type: string, payload: Record<string, unknown>) =>
      f.events.append({
        eventId: `evt_${randomUUID().replaceAll("-", "")}`,
        projectId: f.storage.manifest.projectId,
        runId: `run_${randomUUID().replaceAll("-", "")}`,
        sessionId: `ses_${randomUUID().replaceAll("-", "")}`,
        occurredAt: new Date().toISOString(),
        actor: { kind: "system" },
        schemaVersion: 4,
        policyVersion: `sha256:${"0".repeat(64)}`,
        type,
        payload,
      } as never);
    // A stage handoff changes the event head but no repository byte.
    append("knowledge.integration_target.absorbed", {
      previousTarget: "a".repeat(40),
      mergeBase: "b".repeat(40),
      newTarget: "c".repeat(40),
      absorbedPathCount: 1,
      droppedPathCount: 0,
      pathSetHash: `sha256:${"d".repeat(64)}`,
      occurredAt: new Date().toISOString(),
    });
    await discover();
    expect(scan.calls).toBe(afterFirst);
  },
);
