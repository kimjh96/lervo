import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatRepositoryHealth,
  MAXIMUM_HEALTH_SECTION_BYTES,
} from "../src/repository-health-format.js";
import {
  beginRepositoryHealthProjection,
  publishRepositoryHealth,
} from "../src/repository-health-publication.js";
import { readRepositoryHealth, REPOSITORY_HEALTH_PATH } from "../src/repository-health-reader.js";
import { inspectKnowledgeResidentHealth } from "@lervo/repository-knowledge-runtime";
import { healthNow, healthRevision, healthyProjection } from "./repository-health-fixture.js";

vi.mock("@lervo/repository-knowledge-runtime", async (original) => ({
  ...(await original<typeof import("@lervo/repository-knowledge-runtime")>()),
  inspectKnowledgeResidentHealth: vi.fn(async () => null),
}));
const roots: string[] = [];
async function root() {
  const path = await mkdtemp(resolve(tmpdir(), "lervo-health-"));
  roots.push(path);
  return path;
}
afterEach(async () => {
  vi.mocked(inspectKnowledgeResidentHealth).mockReset();
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("repository health reader and compact section", () => {
  it("uses no bytes for fully observed healthy measures", () => {
    expect(formatRepositoryHealth(healthyProjection(), healthNow)).toBe("");
  });

  it("shows missing, stale and other-revision projections as unknown, never zero", async () => {
    const path = await root();
    const read = (now = healthNow, repositoryRevision = healthRevision) =>
      readRepositoryHealth({ root: path, now, repositoryRevision });
    const missing = await read();
    expect(missing.measures.freshness).toMatchObject({
      status: "unknown",
      value: null,
      reason: "projection_missing_or_unreadable",
    });
    await publishRepositoryHealth(path, healthyProjection());
    const stale = await read(new Date("2026-10-31T02:21:00.000Z"));
    expect(stale.measures.find).toMatchObject({
      status: "unknown",
      value: null,
      reason: "projection_stale",
    });
    expect(formatRepositoryHealth(stale, new Date("2026-10-31T02:21:00.000Z"))).toContain(
      "[age 21m]",
    );
    expect((await read(healthNow, `sha256:${"b".repeat(64)}`)).measures.convergence.reason).toBe(
      "projection_revision_changed",
    );
    const expired = healthyProjection();
    expired.measures.freshness.value!.evaluationValidUntil = "2026-10-31T01:59:00.000Z";
    expired.measures.freshness.value!.cycleValidUntil = "2026-10-31T01:59:00.000Z";
    await publishRepositoryHealth(path, expired);
    expect((await read()).measures.freshness).toMatchObject({
      status: "unknown",
      value: null,
      reason: "freshness_sources_missing_or_stale",
    });
    const malformed = healthyProjection();
    delete (
      malformed.measures.ownerReview.value as Partial<
        NonNullable<typeof malformed.measures.ownerReview.value>
      >
    ).items;
    await writeFile(resolve(path, REPOSITORY_HEALTH_PATH), JSON.stringify(malformed));
    expect((await read()).measures.ownerReview).toMatchObject({
      status: "unknown",
      value: null,
      reason: "projection_invalid",
    });
  });

  it("names the responsible actor and keeps the whole section within its UTF-8 byte cap", () => {
    const p = healthyProjection();
    p.measures.convergence.status = "gap";
    p.measures.convergence.value = {
      state: "attention_required",
      reason: "document_directory_file_capacity_exceeded",
      since: "2026-10-18T04:46:00Z",
      owner: "resident",
      recovery: "next readmission",
      residentState: "attention",
    };
    p.measures.freshness.status = "gap";
    p.measures.freshness.value!.stale = 71;
    p.measures.freshness.value!.evaluated = 186;
    p.measures.freshness.value!.unevaluated = 1504;
    const visible = formatRepositoryHealth(p, healthNow);
    expect(visible).toContain("resident; recovery: next readmission");
    expect(visible).toContain(
      "71/186 evaluated documents stale, 1504 unevaluated; freshness cycle",
    );
    expect(visible).not.toContain("upkeep");
    p.measures.ownerReview.status = "gap";
    p.measures.ownerReview.value = {
      count: 8,
      confirmedCount: 8,
      workstreamCount: 0,
      upkeepCount: 2,
      omitted: 0,
      items: Array.from({ length: 8 }, (_, i) => ({
        itemId: `approval_${i}`,
        kind: "workstream_approval",
        actor: "owner",
        consequence: "repository_write",
        requiresUserAction: true,
        recommendation: `Review exact bytes ${"검토".repeat(10)}`,
        inspectCommand: "lervo workstream current --context",
        waitingSince: healthNow.toISOString(),
        ageMilliseconds: 0,
      })),
    };
    const text = formatRepositoryHealth(p, healthNow);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MAXIMUM_HEALTH_SECTION_BYTES);
    expect(text).toContain("needs owner authority (8)");
    expect(text).toContain("inspect: lervo workstream current --context");
    expect(text).toContain("omitted");
    expect(text).toContain("[age 0m]");
    expect(text).not.toContain("�");
  });
});

it("uses unknown wording for unrecorded reporting and injection", () => {
  const p = healthyProjection();
  p.measures.longestStop.status = "gap";
  p.measures.longestStop.value!.ageMilliseconds = 120_000;
  p.measures.find.status = "gap";
  p.measures.find.value!.lastInjectedAt = null;
  const text = formatRepositoryHealth(p, healthNow);
  expect(text).toContain("reporting unknown");
  expect(text).toContain("last recorded injection unknown");
  expect(text).not.toMatch(/never reported|none injected yet/u);
});

it("renders when a recorded stop was first shown, or that it never was", () => {
  const p = healthyProjection();
  p.measures.longestStop.status = "gap";
  p.measures.longestStop.value = {
    since: "2026-10-30T00:00:00Z",
    ageMilliseconds: 7_200_000,
    reportedAt: "2026-10-30T00:30:00Z",
    unreportedMilliseconds: 1_800_000,
  };
  expect(formatRepositoryHealth(p, healthNow)).toContain("first shown after 30m");
  p.measures.longestStop.value = { ...p.measures.longestStop.value, reportedAt: null };
  expect(formatRepositoryHealth(p, healthNow)).toContain("never shown");
});

it("reads live heartbeat through the 15-minute reconcile interval and expires absent or changed hosting", async () => {
  const path = await root();
  const p = healthyProjection();
  p.measures.convergence.validUntil = new Date(healthNow.getTime() + 120_000).toISOString();
  await publishRepositoryHealth(path, p);
  const now = new Date(healthNow.getTime() + 14 * 60_000);
  vi.mocked(inspectKnowledgeResidentHealth).mockResolvedValue({
    status: "healthy",
    state: "idle",
    heartbeatAt: now.toISOString(),
    reason: null,
  });
  expect(
    (await readRepositoryHealth({ root: path, now, repositoryRevision: healthRevision })).measures
      .convergence.status,
  ).toBe("within_target");
  vi.mocked(inspectKnowledgeResidentHealth).mockResolvedValue({
    status: "not_running",
    state: null,
    heartbeatAt: null,
    reason: "knowledge_resident_absent",
  });
  expect(
    (await readRepositoryHealth({ root: path, now, repositoryRevision: healthRevision })).measures
      .convergence.status,
  ).toBe("unknown");
  vi.mocked(inspectKnowledgeResidentHealth).mockResolvedValue({
    status: "degraded",
    state: "attention",
    heartbeatAt: now.toISOString(),
    reason: "failed",
  });
  expect(
    (await readRepositoryHealth({ root: path, now, repositoryRevision: healthRevision })).measures
      .convergence.status,
  ).toBe("unknown");
});

it("fences an older calculation even when it finishes after a newer same-revision publication", async () => {
  const path = await root();
  const old = await beginRepositoryHealthProjection(path);
  const newer = await beginRepositoryHealthProjection(path);
  const recovered = healthyProjection();
  const stopped = healthyProjection();
  stopped.measures.find.status = "gap";
  await publishRepositoryHealth(path, recovered, newer);
  await publishRepositoryHealth(path, stopped, old);
  expect(
    (await readRepositoryHealth({ root: path, now: healthNow, repositoryRevision: healthRevision }))
      .measures.find.status,
  ).toBe("within_target");
  const latest = await beginRepositoryHealthProjection(path);
  await publishRepositoryHealth(path, stopped, latest);
  await publishRepositoryHealth(path, recovered, newer);
  expect(
    (await readRepositoryHealth({ root: path, now: healthNow, repositoryRevision: healthRevision }))
      .measures.find.status,
  ).toBe("gap");
});

it("expires freshness evaluation and cycle independently between background updates", async () => {
  const path = await root();
  const p = healthyProjection();
  p.measures.freshness.value!.cycleObservedAt = "2026-10-30T02:01:00.000Z";
  p.measures.freshness.value!.cycleValidUntil = "2026-10-31T02:01:00.000Z";
  p.measures.freshness.value!.safety = 3;
  await publishRepositoryHealth(path, p);
  const read = await readRepositoryHealth({
    root: path,
    now: new Date(healthNow.getTime() + 120_000),
    repositoryRevision: healthRevision,
  });
  expect(read.measures.freshness).toMatchObject({
    coverage: "partial",
    value: { stale: 0, safety: null, cycleObservedAt: null },
  });
});
