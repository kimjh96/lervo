import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { resolveProjectPaths } from "@lervo/project";
import type { ProjectStorage } from "@lervo/project-storage";
import type { KnowledgeConvergenceStatus } from "@lervo/repository-knowledge";
import { readAutonomousKnowledgeStatus } from "../src/status.js";
import {
  recordMaintenanceObservation,
  MAINTENANCE_OBSERVATION_PATH,
} from "../src/maintenance-observation.js";
import { discoverConvergenceBaseline } from "../src/baseline.js";
import { writeConvergenceOwnerFence } from "../src/convergence-owner-fence.js";
import { reserveFreshnessPreparation } from "../src/maintenance-schedule.js";
import { packNormalizationDocuments } from "../src/normalization-packing.js";
import {
  recordNormalizationReviewCost,
  normalizationLearnedLimit,
} from "../src/normalization-cost-controller.js";

vi.mock("../src/baseline.js", () => ({
  discoverConvergenceBaseline: vi.fn(() => {
    throw new Error("Full discovery forbidden");
  }),
}));
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  vi.clearAllMocks();
});
async function setup() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-maintenance-status-"));
  roots.push(root);
  return {
    root,
    storage: {
      paths: resolveProjectPaths(root),
      manifest: { projectId: "prj_status" } as ProjectStorage["manifest"],
    },
  };
}
const status = {
  transport: "ready",
  state: "idle",
  outstanding: 0,
  oldestAgeMilliseconds: null,
  activeStage: null,
  reason: null,
  debtCounts: { canonicalization: 0, normalization: 0, lifecycle: 0, historical: 0 },
  lastVerifiedCurrency: null,
} as KnowledgeConvergenceStatus;

it("reads status without an event database or baseline and leaves missing coverage unknown", async () => {
  const { storage } = await setup();
  const value = await readAutonomousKnowledgeStatus(storage);
  expect(value).toMatchObject({
    baselineCurrent: false,
    outstanding: null,
    debtCounts: null,
    observation: { coverage: "unknown", reason: "maintenance_observation_unavailable" },
  });
  expect(discoverConvergenceBaseline).not.toHaveBeenCalled();
});

it("keeps captured verification historical and fails closed on malformed observations", async () => {
  const { root, storage } = await setup();
  const now = new Date("2026-10-08T01:00:00Z");
  await recordMaintenanceObservation({
    root,
    projectId: storage.manifest.projectId,
    status,
    source: "worker",
    owner: null,
    baselineCurrent: true,
    now,
  });
  expect(await readAutonomousKnowledgeStatus(storage, now)).toMatchObject({
    baselineCurrent: false,
    observation: { coverage: "observed", verifiedAt: now.toISOString() },
  });
  expect(
    await readAutonomousKnowledgeStatus(storage, new Date(now.getTime() + 900_001)),
  ).toMatchObject({ observation: { coverage: "stale" } });
  await writeFile(
    resolve(root, MAINTENANCE_OBSERVATION_PATH),
    JSON.stringify({
      schemaVersion: 1,
      projectId: storage.manifest.projectId,
      observedAt: now.toISOString(),
      verifiedAt: null,
      ownerGeneration: null,
      ownerHostHash: null,
      source: "worker",
      status: null,
    }),
  );
  expect(await readAutonomousKnowledgeStatus(storage, now)).toMatchObject({
    observation: { coverage: "unknown" },
  });
});

it("reports a non-owner's own observation as stale, never as the owner's live state", async () => {
  const { root, storage } = await setup();
  const now = new Date("2026-11-19T10:00:00Z");
  const hostHash = `sha256:${"8".repeat(64)}`;
  await writeConvergenceOwnerFence(root, {
    schemaVersion: 1,
    recordedHolderKey: null,
    verdict: {
      role: "waiting_owner",
      reason: "convergence_owner_elsewhere",
      mode: "hub",
      hostHash,
      hostLabel: "mac",
      holder: {
        hostHash: `sha256:${"1".repeat(64)}`,
        label: "wsl",
        generation: 11,
        expiresAt: "2026-11-19T10:20:00.000Z",
      },
      validUntil: null,
      wakeAt: null,
      grantedAt: null,
      yieldUntil: null,
      observedAt: now.toISOString(),
    },
  } as Parameters<typeof writeConvergenceOwnerFence>[1]);
  await recordMaintenanceObservation({
    root,
    projectId: storage.manifest.projectId,
    status: { ...status, state: "attention_required", reason: "knowledge_verification_failed" },
    source: "worker",
    owner: null,
    baselineCurrent: false,
    now,
  });
  expect(await readAutonomousKnowledgeStatus(storage, now)).toMatchObject({
    observation: { coverage: "stale", reason: "maintenance_owner_elsewhere" },
  });
});

it("reserves preparation after two turns across process-local scheduler instances", async () => {
  const { root } = await setup();
  expect(await reserveFreshnessPreparation(root)).toBe(false);
  expect(await reserveFreshnessPreparation(root)).toBe(false);
  expect(await reserveFreshnessPreparation(root)).toBe(true);
  expect(await reserveFreshnessPreparation(root)).toBe(false);
});

it("packs smaller later documents and keeps a learned review limit across an unrelated HEAD", async () => {
  expect(
    packNormalizationDocuments({
      paths: ["large", "small", "next"],
      maximumDocuments: 2,
      maximumBytes: 10,
      size: (path) => (path === "large" ? 100 : 4),
    }),
  ).toEqual(["small", "next"]);
  const { root } = await setup();
  const key = `sha256:${"a".repeat(64)}`;
  await recordNormalizationReviewCost({ root, key, documents: 8, ceiling: 8, outcome: "timeout" });
  await mkdir(resolve(root, ".git"));
  await writeFile(resolve(root, ".git/HEAD"), "unrelated-new-revision");
  expect(await normalizationLearnedLimit(root, key, 8)).toBe(4);
  expect(await normalizationLearnedLimit(root, `sha256:${"b".repeat(64)}`, 8)).toBe(8);
});
