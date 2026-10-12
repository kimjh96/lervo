import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { qualifyActive } from "../lib/context-quality-active-report.mjs";
import { validateActiveProtocol } from "../lib/context-quality-active-runner.mjs";
import { initializeActiveFixture } from "../lib/context-quality-active-fixture.mjs";
import { activeWorker } from "../lib/context-quality-active-worker.mjs";
import { observeDurableCommits } from "../lib/context-quality-durable-commits.mjs";

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

describe("durable-commit allowance", () => {
  const allowed = { ...p, gates: { ...p.gates, durableCommitAllowanceMs: 5 } };
  const committed = () =>
    rows().map((row) => {
      const durableCommits = row.arm === "candidate" ? 7 : 0;
      if (row.arm === "candidate") {
        row.samples.forEach((s) => (s[0] = 14));
        row.processMs = 150;
      }
      return { ...row, durableCommits };
    });
  it("subtracts one allowance per sample and retains raw values", () => {
    const [group] = qualifyActive(committed(), allowed, true).groups;
    expect(group.passed).toBe(true);
    expect(group.elapsedAddedMs.mean).toBe(4);
    expect(group.rawElapsedAddedMs.mean).toBe(9);
    expect(group.processRatio.mean).toBeCloseTo(1.15);
    expect(group.rawProcessRatio.mean).toBe(1.5);
    expect(qualifyActive(committed(), p, true).passed).toBe(false);
  });
  it.each([0, 6, undefined])("rejects %s observed candidate commits", (count) => {
    const r = committed();
    r[1].durableCommits = count;
    expect(qualifyActive(r, allowed, true).passed).toBe(false);
  });
  it("charges split publication commits in full instead of allowing them", () => {
    const r = committed();
    r[1].durableCommits = 9;
    const [group] = qualifyActive(r, allowed, true).groups;
    expect(group.evidence).toBe(true);
    expect(group.processRatio.mean).toBeCloseTo(1.15);
  });
  it("rejects strong commits in the control arm", () => {
    const r = committed();
    r[0].durableCommits = 1;
    expect(qualifyActive(r, allowed, true).passed).toBe(false);
  });
  it("binds the fixed allowance to the packaged v2 protocol only", async () => {
    const v1 = JSON.parse(
      await readFile("benchmarks/context-quality/recording-repair-v12.json", "utf8"),
    );
    expect(() =>
      validateActiveProtocol({ ...v1, gates: { ...v1.gates, durableCommitAllowanceMs: 5 } }),
    ).toThrow();
    const v2 = {
      ...v1,
      protocolId: "context-quality-packaged-resource-v2",
      execution: { kind: "packed_cli", packageRoot: resolve(tmpdir(), "installed") },
    };
    expect(() => validateActiveProtocol(v2)).toThrow();
    v2.gates = { ...v1.gates, durableCommitAllowanceMs: 5 };
    expect(() => validateActiveProtocol(v2)).not.toThrow();
    const v3 = { ...v2, protocolId: "context-quality-packaged-resource-v3" };
    expect(() => validateActiveProtocol(v3)).toThrow();
    v3.pairs = { ...v2.pairs, cold: 30 };
    expect(() => validateActiveProtocol(v3)).not.toThrow();
    expect(() => validateActiveProtocol({ ...v2, pairs: v3.pairs })).toThrow();
    expect(() => validateActiveProtocol({ ...v3, pairs: { ...v3.pairs, warm: 29 } })).toThrow();
    for (const weakened of [6, 10, 0]) {
      expect(() =>
        validateActiveProtocol({
          ...v2,
          gates: { ...v2.gates, durableCommitAllowanceMs: weakened },
        }),
      ).toThrow();
    }
  });
  it("counts only commits on fully synchronized connections", async () => {
    const parent = await mkdtemp(resolve(tmpdir(), "lervo-durable-commits-"));
    const observer = observeDurableCommits();
    try {
      const plain = new DatabaseSync(resolve(parent, "plain.sqlite")),
        strong = new DatabaseSync(resolve(parent, "strong.sqlite"));
      for (const database of [plain, strong]) database.exec("CREATE TABLE t(v);");
      strong.exec("PRAGMA synchronous = FULL; PRAGMA fullfsync = ON;");
      for (const database of [plain, strong]) {
        database.exec("BEGIN IMMEDIATE;");
        database.exec("INSERT INTO t VALUES (1);");
        database.exec("COMMIT;");
      }
      strong.exec("BEGIN; ROLLBACK;");
      expect(observer.count()).toBe(1);
      plain.close();
      strong.close();
    } finally {
      observer.restore();
      await rm(parent, { recursive: true, force: true });
    }
  });
});
