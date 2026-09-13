import { rm } from "node:fs/promises";
import { operatingContractHash } from "@lervo/work-controller";
import { afterEach, describe, expect, it } from "vitest";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";
import { recordResponsibilityFixture } from "./supervision-responsibility.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Node canonical responsibility admission", () => {
  it("rejects a positive readiness response without a canonical binding", async () => {
    const f = await dispatchFixture(roots, false);
    const runtime = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: f.ports,
      runtimeReadiness: f.runtimeReadiness,
    });
    try {
      await expect(runtime.runCycle()).rejects.toThrow("supervision_readiness_changed");
      expect(f.counts().effects).toBe(0);
    } finally {
      await runtime.close();
    }
  });
  it("does not fall back to an old responsibility after a successor is recorded", async () => {
    const f = await dispatchFixture(roots);
    await recordResponsibilityFixture({
      ...f,
      workstreamRevision: f.observation.workstreamRevision,
      causationEventIds: f.observation.causationEventIds,
      responsibility: {
        ...f.task,
        taskPurpose: "Changed canonical duties.",
        predecessorBindingHash: operatingContractHash(f.task),
      },
    });
    const runtime = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: f.ports,
      runtimeReadiness: f.runtimeReadiness,
    });
    try {
      await expect(runtime.runCycle()).rejects.toThrow("supervision_readiness_changed");
      expect(f.counts().effects).toBe(0);
    } finally {
      await runtime.close();
    }
  });
  it("rechecks the canonical binding after the first preflight before invoking an effect", async () => {
    const f = await dispatchFixture(roots);
    const read = f.ports.readWorkerReadiness;
    let reads = 0;
    f.ports.readWorkerReadiness = async (plan) => {
      const observation = await read(plan);
      if (++reads === 2)
        await recordResponsibilityFixture({
          ...f,
          workstreamRevision: f.observation.workstreamRevision,
          causationEventIds: f.observation.causationEventIds,
          responsibility: {
            ...f.task,
            taskPurpose: "Changed canonical duties.",
            predecessorBindingHash: operatingContractHash(f.task),
          },
        });
      return observation;
    };
    const runtime = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: f.ports,
      runtimeReadiness: f.runtimeReadiness,
    });
    try {
      expect((await runtime.runCycle()).disposition).toBe("blocked");
      expect(f.counts().effects).toBe(0);
    } finally {
      await runtime.close();
    }
  });
});
