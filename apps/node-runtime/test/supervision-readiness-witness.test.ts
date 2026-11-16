import { chmod, mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { openProjectStorage } from "@lervo/project-storage";
import { workerReadinessKinds } from "@lervo/work-controller";
import { afterEach, describe, expect, it } from "vitest";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";

// The probe tables in supervision-readiness-probes.test.ts call each observer directly. These
// runtime cycles prove the real Node host wires every probe into both readiness passes, snapshots
// its trusted configuration at open, and records a canonical failure for a permission denial.
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function readEvents(root: string, type: string) {
  const storage = await openProjectStorage(root);
  try {
    return storage.events.list({ limit: 1000 }).filter((event) => event.type === type);
  } finally {
    await storage.close();
  }
}

/** Reads the product-written inspection artifact bound to the newest preflight block. */
async function latestPreflightInspection(root: string) {
  const blocks = await readEvents(root, "work.supervision.preflight.blocked");
  const hash = String(blocks.at(-1)!.payload.inspectionArtifactHash);
  const storage = await openProjectStorage(root);
  try {
    const bytes = await storage.artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`);
    return { blocks: blocks.length, inspection: JSON.parse(Buffer.from(bytes).toString("utf8")) };
  } finally {
    await storage.close();
  }
}

describe("Node readiness probe wiring", { timeout: 60_000 }, () => {
  it("reobserves every probe kind before the effect, records a tool denial once, keeps its configuration", async () => {
    const f = await dispatchFixture(roots);
    const directory = await mkdtemp(resolve(tmpdir(), "lervo-readiness-witness-"));
    roots.push(directory);
    const tool = Object.values(f.runtimeReadiness.verificationTools)[0]![0]!;
    const toolTarget = tool.executable;
    const toolLink = resolve(directory, "tool");
    await symlink(toolTarget, toolLink);
    tool.executable = toolLink;
    const suite = f.suites[0]!;
    const suitePath = resolve(f.root, `.lervo/verifications/${suite.suiteId}.yaml`);
    const savedPath = resolve(f.workspacePath, "src/save.ts");
    const savedMode = (await stat(savedPath)).mode & 0o777;
    const transaction = resolve(f.root, ".lervo/state/knowledge/materialization-transaction");
    const read = f.ports.readWorkerReadiness;
    let cycleReads = 0;
    let arm: { read: number; change(): Promise<void> } | null = null;
    f.ports.readWorkerReadiness = async (plan) => {
      if (++cycleReads === arm?.read) await arm.change();
      return read(plan);
    };
    const inspect = f.ports.inspectEffect;
    f.ports.inspectEffect = async (...args) =>
      f.counts().effects === 0 ? { status: "not_started" } : inspect(...args);
    const open = (configured: boolean) =>
      openNodeOutcomeSupervisionRuntime({
        repositoryRoot: f.root,
        binding: f.binding,
        ports: f.ports,
        ...(configured ? { runtimeReadiness: f.runtimeReadiness } : {}),
      });

    // Without trusted configuration the first pass cannot observe the provider or its tools.
    let runtime = await open(false);
    try {
      expect((await runtime.runCycle()).disposition).toBe("blocked");
      expect(f.attention.at(-1)).toEqual([
        "readiness_provider_unobserved",
        "readiness_tools_unobserved",
        "readiness_verification_unobserved",
      ]);
      expect(cycleReads).toBe(1);
    } finally {
      await runtime.close();
    }

    runtime = await open(true);
    const firstPass = async (change: () => Promise<void>, attention: string[]) => {
      cycleReads = 0;
      arm = { read: 1, change };
      expect((await runtime.runCycle()).disposition).toBe("blocked");
      expect(cycleReads).toBe(1);
      arm = null;
      expect(f.counts()).toEqual({ proposals: 1, effects: 0 });
      expect(f.attention.at(-1)).toEqual(attention);
    };
    // Each final-pass change lands on the second readiness read, after the first pass succeeded.
    const finalPass = async (
      change: () => Promise<void>,
      reasonCode: string,
      unobserved: string[] | null,
    ) => {
      cycleReads = 0;
      arm = { read: 2, change };
      expect((await runtime.runCycle()).disposition).toBe("blocked");
      expect(cycleReads).toBe(2);
      arm = null;
      expect(f.counts()).toEqual({ proposals: 1, effects: 0 });
      expect(f.attention.at(-1)).toEqual(["supervision_preflight_failed", reasonCode]);
      const { inspection } = await latestPreflightInspection(f.root);
      expect(inspection).toMatchObject({
        failurePhase: "readiness",
        reasonCode,
        finalReadiness:
          unobserved === null ? null : { failedCheckKinds: [], unobservedCheckKinds: unobserved },
      });
    };
    const changed = "supervision_readiness_changed";
    try {
      // Knowledge: an open materialization transaction fails the first-pass context probe.
      await firstPass(() => mkdir(transaction), ["readiness_knowledge_unobserved"]);
      await rm(transaction, { recursive: true });
      // Tools: a permission denial is one canonical failure, kept once across repeated blocks.
      await firstPass(async () => {
        await rm(toolLink);
        await writeFile(toolLink, `#!/bin/sh\nexec "${toolTarget}" "$@"\n`, { mode: 0o000 });
      }, ["readiness_tools_failed"]);
      await firstPass(async () => undefined, ["readiness_tools_failed"]);
      const failures = await readEvents(f.root, "work.supervision.readiness.failed");
      expect(failures).toHaveLength(1);
      expect(failures[0]!.payload).toMatchObject({
        assignmentId: f.task.assignmentId,
        executorAgentId: f.task.executorAgentId,
        reasonCode: "readiness_tools_failed",
      });
      expect(JSON.stringify(failures[0]!.payload)).not.toContain(directory);
      await rm(toolLink);
      await symlink(toolTarget, toolLink);
      await finalPass(
        async () => {
          const replaced = structuredClone(suite);
          replaced.commands[0]!.arguments = ["--help"];
          await writeFile(suitePath, JSON.stringify(replaced));
        },
        changed,
        ["verification"],
      );
      await writeFile(suitePath, JSON.stringify(suite));
      await finalPass(() => writeFile(f.login.statePath, "absent"), changed, ["provider"]);
      await writeFile(f.login.statePath, "present");
      await finalPass(() => rm(toolLink), changed, ["tools"]);
      await symlink(toolTarget, toolLink);
      await finalPass(() => chmod(savedPath, 0o400), changed, ["write_scope"]);
      await chmod(savedPath, savedMode);
      await finalPass(
        () => writeFile(resolve(f.workspacePath, "foreign.txt"), "changed\n"),
        changed,
        workerReadinessKinds.filter((kind) =>
          ["read_scope", "write_scope", "lease", "ancestry", "workspace"].includes(kind),
        ),
      );
      await rm(resolve(f.workspacePath, "foreign.txt"));
      await finalPass(
        () => writeFile(resolve(f.root, "src/new.ts"), "export const changed = true;\n"),
        "supervision_knowledge_snapshot_changed",
        null,
      );
      await rm(resolve(f.root, "src/new.ts"));
      expect((await latestPreflightInspection(f.root)).blocks).toBe(6);

      // The runtime keeps the configuration it opened with.
      f.runtimeReadiness.providerExecutables.codex = "/missing/changed-after-open";
      f.runtimeReadiness.providerLoginContexts.codex.configurationDirectory = "/missing/profile";
      tool.executable = "/missing/changed-after-open";
      cycleReads = 0;
      expect((await runtime.runCycle()).disposition).toBe("effect_confirmed");
      expect(cycleReads).toBe(2);
      expect(f.counts()).toEqual({ proposals: 1, effects: 1 });
      expect(await readEvents(f.root, "work.supervision.readiness.failed")).toHaveLength(1);
    } finally {
      await runtime.close();
    }
  });

  it("records a provider permission denial as canonical failure and resumes after repair", async () => {
    const f = await dispatchFixture(roots);
    const directory = await mkdtemp(resolve(tmpdir(), "lervo-runtime-permission-"));
    roots.push(directory);
    const executable = resolve(directory, "provider");
    const original = f.runtimeReadiness.providerExecutables.codex!;
    await writeFile(executable, `#!/bin/sh\nexec "${original}" "$@"\n`, { mode: 0o000 });
    f.runtimeReadiness.providerExecutables.codex = executable;
    const inspect = f.ports.inspectEffect;
    f.ports.inspectEffect = async (...args) => {
      const observed = await inspect(...args);
      return observed.status === "uncertain" ? { status: "not_started" } : observed;
    };
    const runtime = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: f.ports,
      runtimeReadiness: f.runtimeReadiness,
    });
    try {
      expect((await runtime.runCycle()).disposition).toBe("blocked");
      expect((await runtime.runCycle()).disposition).toBe("blocked");
      expect(f.counts().effects).toBe(0);
      expect(f.attention.at(-1)).toContain("readiness_provider_failed");
      const before = await readEvents(f.root, "work.supervision.readiness.failed");
      expect(before).toHaveLength(1);
      expect(before[0]!.payload).toMatchObject({
        assignmentId: f.task.assignmentId,
        executorAgentId: f.task.executorAgentId,
        reasonCode: "readiness_provider_failed",
      });
      expect(JSON.stringify(before[0]!.payload)).not.toContain(directory);
      await chmod(executable, 0o700);
      expect((await runtime.runCycle()).disposition).toBe("effect_confirmed");
      expect(f.counts()).toEqual({ proposals: 1, effects: 1 });
      expect(await readEvents(f.root, "work.supervision.readiness.failed")).toHaveLength(1);
    } finally {
      await runtime.close();
    }
  });
});
