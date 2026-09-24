import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { openProjectStorage } from "@lervo/project-storage";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("resumes the recorded decision after repairing a final preflight failure and restarting", async () => {
  const f = await dispatchFixture(roots);
  const directory = await mkdtemp(resolve(tmpdir(), "lervo-preflight-recovery-"));
  roots.push(directory);
  const executable = resolve(directory, "provider");
  const original = f.runtimeReadiness.providerExecutables.codex!;
  await symlink(original, executable);
  f.runtimeReadiness.providerExecutables.codex = executable;
  const read = f.ports.readWorkerReadiness;
  let reads = 0;
  f.ports.readWorkerReadiness = async (plan) => {
    if (++reads === 2) await rm(executable);
    return read(plan);
  };
  const inspect = f.ports.inspectEffect;
  f.ports.inspectEffect = async (...args) =>
    f.counts().effects === 0 ? { status: "not_started" } : inspect(...args);
  const open = () =>
    openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: f.ports,
      runtimeReadiness: f.runtimeReadiness,
    });
  let runtime = await open();
  try {
    expect((await runtime.runCycle()).disposition).toBe("blocked");
    expect(f.counts()).toEqual({ proposals: 1, effects: 0 });
    expect(f.attention.at(-1)).toEqual([
      "supervision_preflight_failed",
      "supervision_readiness_changed",
    ]);
    const blockedStorage = await openProjectStorage(f.root);
    try {
      const blocks = blockedStorage.events
        .list({ limit: 1000 })
        .filter((event) => event.type === "work.supervision.preflight.blocked");
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.payload).toMatchObject({
        failurePhase: "readiness",
        reasonCode: "supervision_readiness_changed",
      });
    } finally {
      await blockedStorage.close();
    }
    await runtime.close();
    await symlink(original, executable);
    runtime = await open();
    expect((await runtime.runCycle()).disposition).toBe("effect_confirmed");
    expect(f.counts()).toEqual({ proposals: 1, effects: 1 });
    await runtime.close();
    runtime = await open();
    expect((await runtime.runCycle()).disposition).toBe("effect_confirmed");
    expect(f.counts().effects).toBe(1);
  } finally {
    await runtime.close();
  }
}, 30_000);
