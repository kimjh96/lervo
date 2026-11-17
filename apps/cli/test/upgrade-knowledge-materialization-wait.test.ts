import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { loadProjectManifest } from "@lervo/project";
import { canonicalJson } from "@lervo/repository-knowledge";
import { afterEach, describe, expect, it } from "vitest";

import { runCli as runUnisolatedCli } from "../src/main.js";
import type { KnowledgeMaterializationWaitTiming } from "../src/knowledge-materialization-wait.js";
import { withIsolatedUpgradeHost } from "./upgrade-host-isolation.js";

const runCli = withIsolatedUpgradeHost(runUnisolatedCli);

const MARKER = ".lervo/state/knowledge/materialization-transaction";
const PLAN_ID = `knormplan_${"c".repeat(24)}`;
const roots: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function io(root: string, stdout: string[], stderr: string[]) {
  return {
    cwd: root,
    stdout: (message: string) => stdout.push(message),
    stderr: (message: string) => stderr.push(message),
  };
}

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-upgrade-materialization-"));
  roots.push(root);
  await writeFile(resolve(root, "main.ts"), "export const value = true;\n");
  expect(await runCli(["init", "--minimal", "--name", "settle-fixture"], io(root, [], []))).toBe(0);
  return root;
}

function liveProcess(): number {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  children.push(child);
  return child.pid!;
}

async function exitedProcess(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((done) => child.once("exit", done));
  return child.pid!;
}

/** The resident knowledge worker's journal, as observed in production during event recording. */
async function writeMarker(root: string, ownerPid: number): Promise<string> {
  const journal = resolve(root, MARKER, "journal.json");
  await mkdir(resolve(root, MARKER), { recursive: true });
  await writeFile(
    journal,
    `${canonicalJson({
      schemaVersion: 1,
      transactionType: "knowledge_materialization",
      planId: PLAN_ID,
      projectId: (await loadProjectManifest(root)).projectId,
      ownerPid,
      phase: "event_recording",
      publishedCount: 1,
      activeIndex: null,
      operations: [
        {
          path: "README.md",
          action: "create",
          beforeHash: null,
          afterHash: `sha256:${"d".repeat(64)}`,
        },
      ],
    })}\n`,
  );
  return journal;
}

function fakeTiming(onSleep: (call: number) => Promise<void> | void = () => undefined) {
  let current = 0;
  const sleeps: number[] = [];
  const timing: KnowledgeMaterializationWaitTiming = {
    now: () => current,
    sleep: async (durationMs) => {
      sleeps.push(durationMs);
      current += durationMs;
      await onSleep(sleeps.length);
    },
  };
  return { sleeps, timing };
}

async function upgradePlan(
  root: string,
  timing: KnowledgeMaterializationWaitTiming,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(["upgrade", "--json"], io(root, stdout, stderr), {
    knowledgeMaterializationWait: timing,
  });
  return { code, stdout: stdout.join(""), stderr: stderr.join("") };
}

describe("foreground commands and a knowledge materialization marker", () => {
  it("waits for a live resident materialization and then plans and applies the upgrade", async () => {
    const root = await repository();
    const expected = await upgradePlan(root, fakeTiming().timing);
    const ownerPid = liveProcess();
    await writeMarker(root, ownerPid);
    const { sleeps, timing } = fakeTiming(async (call) => {
      if (call === 2) await rm(resolve(root, MARKER), { recursive: true });
    });

    const planned = await upgradePlan(root, timing);
    expect(sleeps).toEqual([2_000, 2_000]);
    expect(planned.stderr).toContain(
      `Waiting up to 15 min for the live knowledge materialization owned by process ${ownerPid} (plan ${PLAN_ID}, phase event_recording) to settle.`,
    );
    const plan = JSON.parse(planned.stdout) as {
      planId: string;
      stages: { knowledge: { reason: string } };
    };
    expect(plan.stages.knowledge.reason).not.toBe("knowledge_recovery_required");
    expect(plan.planId).toBe((JSON.parse(expected.stdout) as { planId: string }).planId);

    await writeMarker(root, ownerPid);
    const applying = fakeTiming(async () => {
      await rm(resolve(root, MARKER), { recursive: true });
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runCli(
      ["upgrade", "--apply", "--approval", plan.planId, "--json"],
      io(root, stdout, stderr),
      {
        knowledgeMaterializationWait: applying.timing,
        knowledgeCycleAdmission: {
          directory: await mkdtemp(resolve(tmpdir(), "lervo-admission-")),
        },
      },
    );
    expect(code, stdout.join("") + stderr.join("")).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      operation: "repository_upgrade",
      approvedPlanId: plan.planId,
    });
    expect(stdout.join("")).not.toContain("knowledge_recovery_required");
    expect(applying.sleeps).toEqual([2_000]);
  }, 60_000);

  it("fails precisely when the live owner holds the marker for the whole wait", async () => {
    const root = await repository();
    const ownerPid = liveProcess();
    const journal = await writeMarker(root, ownerPid);
    const before = await readFile(journal, "utf8");
    const { sleeps, timing } = fakeTiming();

    const result = await upgradePlan(root, { ...timing, waitMs: 60_000 });
    expect(result.code).toBe(1);
    const failure = JSON.parse(result.stdout) as { error: { code: string; message: string } };
    expect(failure.error.code).toBe("knowledge_materialization_wait_expired");
    expect(failure.error.message).toContain(
      `owned by process ${ownerPid} (plan ${PLAN_ID}, phase event_recording) did not settle`,
    );
    expect(sleeps.reduce((total, value) => total + value, 0)).toBe(60_000);
    expect(await readFile(journal, "utf8")).toBe(before);
  }, 60_000);

  it("refuses an interrupted marker immediately with the recovery command", async () => {
    const root = await repository();
    const journal = await writeMarker(root, await exitedProcess());
    const before = await readFile(journal, "utf8");
    const { sleeps, timing } = fakeTiming();

    const result = await upgradePlan(root, timing);
    expect(result.code).toBe(1);
    const failure = JSON.parse(result.stdout) as { error: { code: string; message: string } };
    expect(failure.error.code).toBe("knowledge_recovery_required");
    expect(failure.error.message).toContain("`lervo knowledge materialize --recover`");
    expect(result.stderr).toBe("");
    expect(sleeps).toEqual([]);
    expect(await readFile(journal, "utf8")).toBe(before);
  }, 60_000);

  it("lets knowledge lint and state status wait for a live owner", async () => {
    const root = await repository();
    const ownerPid = liveProcess();
    for (const args of [
      ["knowledge", "lint", "--json"],
      ["state", "status", "--json"],
    ]) {
      await writeMarker(root, ownerPid);
      const { sleeps, timing } = fakeTiming(async () => {
        await rm(resolve(root, MARKER), { recursive: true });
      });
      const stdout: string[] = [];
      const stderr: string[] = [];
      await runCli(args, io(root, stdout, stderr), { knowledgeMaterializationWait: timing });
      expect(stdout.join(""), args.join(" ")).not.toContain("recovery_required");
      expect(stderr.join(""), args.join(" ")).toContain(`process ${ownerPid}`);
      expect(sleeps, args.join(" ")).toEqual([2_000]);
    }
  }, 60_000);
});
