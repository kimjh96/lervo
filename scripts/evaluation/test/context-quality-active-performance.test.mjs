import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { qualifyActive } from "../lib/context-quality-active-report.mjs";
import { validateActiveProtocol } from "../lib/context-quality-active-runner.mjs";
import { initializeActiveFixture } from "../lib/context-quality-active-fixture.mjs";
import { activeWorker } from "../lib/context-quality-active-worker.mjs";

const p = {
  profiles: [4096],
  pairs: { warm: 2 },
  warmups: 2,
  samples: 5,
  concurrency: 4,
  gates: {
    meanAddedMsUpper95: 10,
    processRatioUpper95: 1.2,
    rssRatioUpper95: 1.25,
    cpuRatioUpper95: 1.25,
    maximumStateBytesPerRequest: 131072,
  },
};
const sample = () => [5, 5, 100, 50, 10, 0, 100, 0, 1, "sha256:" + "a".repeat(64)];
function rows() {
  return Array.from({ length: 4 }, (_, i) => ({
    profile: 4096,
    workload: "warm",
    pair: Math.floor(i / 2),
    arm: i % 2 ? "candidate" : "control",
    status: "completed",
    processMs: 100,
    resourceUsage: { maxRSS: 100 },
    samples: Array.from({ length: 5 }, sample),
    warmups: Array.from({ length: 2 }, sample),
    semanticValid: true,
    staleSourceRejected: true,
    integrity: true,
    eventCount: i % 2 ? 14 : 0,
    expectedEventCount: i % 2 ? 14 : 0,
    stateGrowthBytes: i % 2 ? 1000 : 0,
  }));
}
it("qualifies only complete paired semantic and durable evidence", () => {
  expect(qualifyActive(rows(), p, true).passed).toBe(true);
});
it.each([
  "missing",
  "duplicate",
  "failed",
  "nonfinite",
  "zero_cpu",
  "request_count",
  "parity",
  "event",
  "integrity",
  "stale",
  "storage",
  "cpu",
  "latency",
  "process",
  "rss",
  "build",
])("rejects %s without dropping the failed cohort", (kind) => {
  const r = rows();
  if (kind === "missing") r.pop();
  if (kind === "duplicate") r[3] = { ...r[1] };
  if (kind === "failed") r[1].status = "failed";
  if (kind === "nonfinite") r[1].resourceUsage.maxRSS = Infinity;
  if (kind === "zero_cpu") r[0].samples.forEach((s) => (s[1] = 0));
  if (kind === "request_count") r.forEach((row) => row.samples.forEach((s) => (s[8] = 2)));
  if (kind === "parity") r[1].samples[0][9] = "sha256:" + "b".repeat(64);
  if (kind === "event") r[1].eventCount--;
  if (kind === "integrity") r[1].integrity = false;
  if (kind === "stale") r[1].staleSourceRejected = false;
  if (kind === "storage") r[1].stateGrowthBytes = 9999999;
  if (kind === "cpu") r[1].samples.forEach((s) => (s[1] = 100));
  if (kind === "latency") r[1].samples.forEach((s) => (s[0] = 100));
  if (kind === "process") r[1].processMs = 1000;
  if (kind === "rss") r[1].resourceUsage.maxRSS = 1000;
  expect(qualifyActive(r, p, kind !== "build").passed).toBe(false);
});
it("rejects an unfrozen or weakened execution protocol", () => {
  expect(() => validateActiveProtocol(p)).toThrow();
});
it("exercises active storage, changed bytes and concurrent waiters in disposable repositories", async () => {
  const parent = await mkdtemp(resolve(tmpdir(), "lervo-active-test-"));
  try {
    for (const workload of ["changed", "concurrent"]) {
      const root = resolve(parent, workload);
      await initializeActiveFixture(root);
      const result = await activeWorker(root, "candidate", workload, 4096, {
        warmups: 0,
        samples: 2,
        concurrency: 4,
      });
      expect(result.semanticValid).toBe(true);
      expect(result.staleSourceRejected).toBe(true);
      expect(result.integrity).toBe(true);
      expect(result.eventCount).toBe(result.expectedEventCount);
      expect(result.stateGrowthBytes).toBeGreaterThan(0);
    }
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}, 30000);

it.each([
  "active-resource-v1",
  "recording-repair-v7",
  "recording-repair-v8",
  "recording-repair-v9",
  "recording-repair-v10",
  "recording-repair-v11",
  "recording-repair-v12",
  "native-source-v1",
])("accepts frozen %s and rejects gate weakening", async (name) => {
  const protocol = JSON.parse(await readFile(`benchmarks/context-quality/${name}.json`, "utf8"));
  expect(() => validateActiveProtocol(protocol)).not.toThrow();
  protocol.gates.meanAddedMsUpper95++;
  expect(() => validateActiveProtocol(protocol)).toThrow();
});
