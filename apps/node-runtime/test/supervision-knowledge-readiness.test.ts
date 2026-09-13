import { projectOutcomeSupervision } from "@lervo/work-controller";
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createKnowledgeMigrationPlan,
  applyKnowledgeMigrationPlan,
  structuralManifestPath,
} from "@lervo/repository-knowledge";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import {
  inspectSupervisionKnowledgeReadiness,
  observeSupervisionKnowledgeReadiness,
} from "../src/supervision-knowledge-readiness.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const f = await dispatchFixture(roots);
  const plan = (await f.ports.propose(
    projectOutcomeSupervision({
      snapshot: f.observation,
      now: f.ports.now(),
      maximumRecoveryDecisions: 1,
    }),
  ))!;
  const readiness = await f.ports.readWorkerReadiness(plan);
  return {
    ...f,
    readiness,
    input: { repositoryRoot: f.root, projectId: plan.projectId, readiness, now: f.ports.now },
  };
}

describe("supervision knowledge observation", { timeout: 30_000 }, () => {
  it("supplements current knowledge without changing application evidence or freshness", async () => {
    const f = await fixture();
    const result = await observeSupervisionKnowledgeReadiness(f.input);
    const check = result.observation.checks.find((item) => item.kind === "knowledge")!;
    expect(check.status).toBe("passed");
    expect(check.evidenceHash).not.toBe(
      f.readiness.observation.checks.find((item) => item.kind === "knowledge")!.evidenceHash,
    );
    expect(result.observation.observedAt).toBe(f.readiness.observation.observedAt);
    expect(JSON.stringify(result)).not.toContain(f.root);
  });

  it.each(["missing", "stale", "normalization", "transaction", "project", "time"])(
    "does not accept %s knowledge evidence",
    async (change) => {
      const f = await fixture();
      if (change === "missing") await rm(resolve(f.root, structuralManifestPath));
      if (change === "stale")
        await writeFile(resolve(f.root, "src/new.ts"), "export const changed = true;\n");
      if (change === "normalization") {
        await mkdir(resolve(f.root, "docs"), { recursive: true });
        await writeFile(
          resolve(f.root, "docs/task.md"),
          "# Task requirements\n\nA new requirement.\n",
        );
        await applyKnowledgeMigrationPlan(
          await createKnowledgeMigrationPlan({ repositoryRoot: f.root }),
          new Date(),
          () => undefined,
        );
      }
      if (change === "transaction")
        await mkdir(resolve(f.root, ".lervo/state/knowledge/materialization-transaction"));
      if (change === "project") f.input.projectId = "prj_foreign";
      if (change === "time") {
        let calls = 0;
        const time = Date.parse(f.ports.now());
        f.input.now = () => new Date(time + (calls++ === 0 ? 0 : 60_001)).toISOString();
      }
      const result = await observeSupervisionKnowledgeReadiness(f.input);
      expect(result.observation.checks.find((item) => item.kind === "knowledge")).toMatchObject({
        status: "unobserved",
        evidenceHash: null,
      });
    },
  );

  it("accepts a bounded slow inspection but never refreshes stale application context", async () => {
    const f = await fixture();
    const started = Date.parse(f.ports.now());
    let calls = 0;
    const now = () => new Date(started + (calls++ === 0 ? 0 : 40_000)).toISOString();
    const result = await observeSupervisionKnowledgeReadiness({ ...f.input, now });
    expect(result.observation.checks.find((item) => item.kind === "knowledge")?.status).toBe(
      "passed",
    );
    expect(result.observation.observedAt).toBe(f.readiness.observation.observedAt);
    expect(result.observation.validUntil).toBe(f.readiness.observation.validUntil);
  });

  it("expires a prepared inspection instead of granting a new window on application", async () => {
    const f = await fixture();
    const preparedInspection = await inspectSupervisionKnowledgeReadiness(f.input);
    const now = () => new Date(Date.parse(f.ports.now()) + 60_001).toISOString();
    const result = await observeSupervisionKnowledgeReadiness({
      ...f.input,
      preparedInspection,
      now,
    });
    expect(result.observation.checks.find((item) => item.kind === "knowledge")).toMatchObject({
      status: "unobserved",
      evidenceHash: null,
    });
  });

  it("caps fresh task readiness at the original knowledge expiration", async () => {
    const f = await fixture();
    const preparedInspection = await inspectSupervisionKnowledgeReadiness(f.input);
    const started = Date.parse(f.ports.now());
    f.readiness.observation.observedAt = new Date(started + 40_000).toISOString();
    f.readiness.observation.validUntil = new Date(started + 70_000).toISOString();
    const result = await observeSupervisionKnowledgeReadiness({
      ...f.input,
      preparedInspection,
      now: () => new Date(started + 40_000).toISOString(),
    });
    expect(result.observation.validUntil).toBe(preparedInspection.validUntil);
  });

  it.each(["failed", "unobserved", "not_required"] as const)(
    "preserves %s application context evidence",
    async (status) => {
      const f = await fixture();
      f.readiness.observation.checks.find((item) => item.kind === "knowledge")!.status = status;
      expect(await observeSupervisionKnowledgeReadiness(f.input)).toEqual(f.readiness);
    },
  );

  it("blocks effects when knowledge becomes stale after the initial preflight", async () => {
    const f = await dispatchFixture(roots);
    const read = f.ports.readWorkerReadiness;
    let calls = 0;
    f.ports.readWorkerReadiness = async (plan) => {
      if (++calls === 2)
        await writeFile(resolve(f.root, "src/new.ts"), "export const changed = true;\n");
      return read(plan);
    };
    const runtime = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: f.ports,
      runtimeReadiness: f.runtimeReadiness,
    });
    try {
      expect((await runtime.runCycle()).disposition).toBe("uncertain");
      expect(f.counts().effects).toBe(0);
      expect(calls).toBe(2);
    } finally {
      await runtime.close();
    }
  });
});
