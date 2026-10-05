import { rm } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { RepositoryKnowledgeError } from "@lervo/repository-knowledge";

import { cycleScopedConvergenceDiscovery } from "../src/baseline.js";
import { fixture } from "./fixture.js";

const scan = vi.hoisted(() => ({ concurrentChanges: 0 }));

vi.mock("@lervo/repository-knowledge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lervo/repository-knowledge")>();
  return {
    ...actual,
    scanConfiguredRepositoryKnowledge: async (
      ...args: Parameters<typeof actual.scanConfiguredRepositoryKnowledge>
    ) => {
      if (scan.concurrentChanges > 0) {
        scan.concurrentChanges -= 1;
        throw new actual.RepositoryKnowledgeError(
          "source_bytes_changed",
          "The repository revision changed during the scan.",
        );
      }
      return actual.scanConfiguredRepositoryKnowledge(...args);
    },
  };
});

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  scan.concurrentChanges = 0;
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
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
