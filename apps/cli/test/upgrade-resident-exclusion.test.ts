import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { loadProjectManifest } from "@lervo/project";
import { canonicalJson } from "@lervo/repository-knowledge";
import { acquireFullCycleAdmission } from "@lervo/repository-knowledge-runtime";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const MARKER = ".lervo/state/knowledge/materialization-transaction";
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

async function temporary(prefix: string): Promise<string> {
  const path = await mkdtemp(resolve(tmpdir(), prefix));
  roots.push(path);
  return path;
}

async function repository(): Promise<string> {
  const root = await temporary("lervo-upgrade-exclusion-");
  await writeFile(resolve(root, "main.ts"), "export const value = true;\n");
  expect(await runCli(["init", "--minimal", "--name", "exclusion-fixture"], io(root, [], []))).toBe(
    0,
  );
  return root;
}

async function planId(root: string): Promise<string> {
  const stdout: string[] = [];
  expect(await runCli(["upgrade", "--json"], io(root, stdout, []))).toBe(0);
  return (JSON.parse(stdout.join("")) as { planId: string }).planId;
}

/** A resident cycle's admission attempt, as `startAutonomousKnowledgeWorker` makes it. */
async function residentCycleAdmitted(directory: string, root: string): Promise<boolean> {
  try {
    const admission = await acquireFullCycleAdmission({
      repositoryRoot: root,
      directory,
      pollMilliseconds: 10,
      signal: AbortSignal.timeout(150),
    });
    await admission.release();
    return true;
  } catch (error) {
    if ((error as { code?: unknown }).code === "knowledge_cancelled") return false;
    throw error;
  }
}

describe("lervo upgrade --apply and the background knowledge resident", () => {
  it("holds the resident's full-cycle admission for the whole apply and releases it after", async () => {
    const root = await repository();
    const directory = await temporary("lervo-upgrade-admission-");
    const approval = await planId(root);
    // A live materialization pauses the apply mid-way, which is where a resident cycle would
    // otherwise start; the observation runs at that point.
    const owner = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    children.push(owner);
    await mkdir(resolve(root, MARKER), { recursive: true });
    await writeFile(
      resolve(root, MARKER, "journal.json"),
      `${canonicalJson({
        schemaVersion: 1,
        transactionType: "knowledge_materialization",
        planId: `knormplan_${"e".repeat(24)}`,
        projectId: (await loadProjectManifest(root)).projectId,
        ownerPid: owner.pid,
        phase: "publishing",
        publishedCount: 0,
        activeIndex: 0,
        operations: [
          {
            path: "README.md",
            action: "create",
            beforeHash: null,
            afterHash: `sha256:${"f".repeat(64)}`,
          },
        ],
      })}\n`,
    );
    const admittedDuringApply: boolean[] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runCli(
      ["upgrade", "--apply", "--approval", approval, "--json"],
      io(root, stdout, stderr),
      {
        knowledgeCycleAdmission: { directory },
        knowledgeMaterializationWait: {
          now: () => 0,
          sleep: async () => {
            admittedDuringApply.push(await residentCycleAdmitted(directory, root));
            await rm(resolve(root, MARKER), { recursive: true });
          },
        },
      },
    );
    expect(code, stdout.join("") + stderr.join("")).toBe(0);
    expect(admittedDuringApply).toEqual([false]);
    expect(await residentCycleAdmitted(directory, root)).toBe(true);
  }, 60_000);

  it("waits for a running resident cycle to finish before applying", async () => {
    const root = await repository();
    const directory = await temporary("lervo-upgrade-admission-");
    const approval = await planId(root);
    const cycle = await acquireFullCycleAdmission({
      repositoryRoot: root,
      directory,
      signal: AbortSignal.timeout(1_000),
    });
    const release = setTimeout(() => void cycle.release(), 300);
    const stdout: string[] = [];
    const stderr: string[] = [];
    try {
      const code = await runCli(
        ["upgrade", "--apply", "--approval", approval, "--json"],
        io(root, stdout, stderr),
        { knowledgeCycleAdmission: { directory, pollMilliseconds: 20 } },
      );
      expect(code, stdout.join("") + stderr.join("")).toBe(0);
    } finally {
      clearTimeout(release);
      await cycle.release();
    }
    expect(stderr.join("")).toContain(
      "Waiting up to 15 min for the running background knowledge cycle on this host to stop at its next stage boundary before upgrading.",
    );
    expect(JSON.parse(stdout.join(""))).toMatchObject({ approvedPlanId: approval });
  }, 60_000);

  it("goes ahead of a resident cycle that waited first, which runs after the upgrade (ADR-0574)", async () => {
    const root = await repository();
    const directory = await temporary("lervo-upgrade-admission-");
    const approval = await planId(root);
    const signal = AbortSignal.timeout(60_000);
    const cycle = await acquireFullCycleAdmission({
      repositoryRoot: resolve(root, "running-repository"),
      directory,
      signal,
    });
    let upgradeFinished = false;
    let residentAfterUpgrade: boolean | null = null;
    const resident = acquireFullCycleAdmission({
      repositoryRoot: resolve(root, "waiting-repository"),
      directory,
      pollMilliseconds: 10,
      signal,
    }).then(async (admission) => {
      residentAfterUpgrade = upgradeFinished;
      await admission.release();
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    const release = setTimeout(() => void cycle.release(), 300);
    const stderr: string[] = [];
    try {
      // Only the order matters here: an exact plan refused under admission still held it first.
      await runCli(["upgrade", "--apply", "--approval", approval, "--json"], io(root, [], stderr), {
        knowledgeCycleAdmission: { directory, pollMilliseconds: 20 },
      });
      upgradeFinished = true;
      await resident;
    } finally {
      clearTimeout(release);
      await cycle.release();
    }
    expect(stderr.join("")).toContain("to stop at its next stage boundary before upgrading.");
    expect(residentAfterUpgrade).toBe(true);
  }, 60_000);

  it("refuses without changes when the resident cycle outlasts the wait", async () => {
    const root = await repository();
    const directory = await temporary("lervo-upgrade-admission-");
    const approval = await planId(root);
    const cycle = await acquireFullCycleAdmission({
      repositoryRoot: root,
      directory,
      signal: AbortSignal.timeout(1_000),
    });
    const stdout: string[] = [];
    try {
      const code = await runCli(
        ["upgrade", "--apply", "--approval", approval, "--json"],
        io(root, stdout, []),
        { knowledgeCycleAdmission: { directory, pollMilliseconds: 20, waitMs: 200 } },
      );
      expect(code).toBe(1);
    } finally {
      await cycle.release();
    }
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      error: { code: "knowledge_cycle_admission_wait_expired" },
    });
    expect(await planId(root)).toBe(approval);
  }, 60_000);
});
