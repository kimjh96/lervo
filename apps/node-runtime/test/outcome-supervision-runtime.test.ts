import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { changeAgentStatus } from "@lervo/agent-workforce";
import { afterEach, describe, expect, it } from "vitest";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { NodeSupervisionStore, type NodeSupervisionSession } from "../src/supervision-store.js";
import { supervisionFixture } from "./supervision.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Node supervision repository composition", () => {
  it("rechecks owner authority after task admission work immediately before an effect", async () => {
    const f = await supervisionFixture(roots);
    const readAdmission = f.ports.readAdmission;
    let reads = 0;
    f.ports.readAdmission = async (plan) => {
      const observed = await readAdmission(plan);
      if (++reads === 3)
        await changeAgentStatus({
          repositoryRoot: f.root,
          agentId: f.owner.agentId,
          expectedRevision: 1,
          status: "suspended",
        });
      return observed;
    };
    const runtime = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: f.ports,
    });
    try {
      expect((await runtime.runCycle()).disposition).toBe("uncertain");
      expect(f.counts().effects).toBe(0);
    } finally {
      await runtime.close();
    }
  });
  it("persists a fenced effect and confirms it after restart without executing twice", async () => {
    const f = await supervisionFixture(roots);
    const first = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: f.ports,
    });
    try {
      expect((await first.runCycle()).disposition).toBe("effect_confirmed");
      expect((await first.runCycle()).disposition).toBe("idle");
      expect(f.counts()).toEqual({ proposals: 1, effects: 1 });
    } finally {
      await first.close();
    }
    const reopened = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: f.ports,
    });
    try {
      expect((await reopened.runCycle()).disposition).toBe("effect_confirmed");
      expect(f.counts().effects).toBe(1);
    } finally {
      await reopened.close();
    }
  });

  it("recovers old-source uncertainty before proposing a replacement", async () => {
    const f = await supervisionFixture(roots);
    f.failEffect();
    const first = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: f.ports,
    });
    try {
      expect((await first.runCycle()).disposition).toBe("uncertain");
    } finally {
      await first.close();
    }
    f.observation.sourceRevisionDigest = `sha256:${"f".repeat(64)}`;
    const reopened = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: f.ports,
    });
    try {
      expect((await reopened.runCycle()).disposition).toBe("uncertain");
      expect(f.counts()).toEqual({ proposals: 1, effects: 1 });
      expect(f.attention.at(-1)).toContain("pending_decision_requires_reconciliation");
    } finally {
      await reopened.close();
    }
  });

  it("does not treat Hub configuration and a capable reader as converged authority", async () => {
    const f = await supervisionFixture(roots);
    const manifest = resolve(f.root, ".lervo/project.yaml");
    await writeFile(
      manifest,
      (await readFile(manifest, "utf8")).replace("hubSyncEnabled: false", "hubSyncEnabled: true"),
    );
    const runtime = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: f.ports,
    });
    try {
      expect((await runtime.runCycle()).disposition).toBe("blocked");
      expect(f.counts()).toEqual({ proposals: 0, effects: 0 });
    } finally {
      await runtime.close();
    }
  });

  it("detects owner changes even when task sources have not changed and the previous cycle was idle", async () => {
    const f = await supervisionFixture(roots);
    const runtime = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: f.ports,
    });
    try {
      await runtime.runCycle();
      expect((await runtime.runCycle()).disposition).toBe("idle");
      await changeAgentStatus({
        repositoryRoot: f.root,
        agentId: f.owner.agentId,
        expectedRevision: 1,
        status: "suspended",
      });
      expect((await runtime.runCycle()).disposition).toBe("blocked");
      expect(f.counts().effects).toBe(1);
    } finally {
      await runtime.close();
    }
  });

  it("keeps ownership until a closing runtime's active operation settles and rejects escaped sessions", async () => {
    const f = await supervisionFixture(roots);
    const first = await NodeSupervisionStore.open({ repositoryRoot: f.root, binding: f.binding });
    const second = await NodeSupervisionStore.open({ repositoryRoot: f.root, binding: f.binding });
    let release!: () => void;
    let entered!: () => void;
    let escaped!: NodeSupervisionSession;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = first.withOwner(async (session) => {
      escaped = session;
      entered();
      await wait;
      session.commit(() => undefined);
    });
    await started;
    const closing = first.close();
    expect(await second.withOwner(async () => "unexpected")).toBeNull();
    release();
    await running;
    await closing;
    expect(() => escaped.commit(() => undefined)).toThrow("supervision_session_closed");
    try {
      expect(await second.withOwner(async () => "next")).toBe("next");
    } finally {
      await second.close();
    }
  });
});
