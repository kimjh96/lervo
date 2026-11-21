import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { loadProjectManifest } from "@lervo/project";
import { canonicalJson } from "@lervo/repository-knowledge";
import { acquireFullCycleAdmission } from "@lervo/repository-knowledge-runtime";
import { afterEach, describe, expect, it } from "vitest";

import { runCli as runUnisolatedCli } from "../src/main.js";
import { withKnowledgeResidentExclusion } from "../src/upgrade-resident-exclusion.js";
import { withIsolatedUpgradeHost } from "./upgrade-host-isolation.js";

const runCli = withIsolatedUpgradeHost(runUnisolatedCli);

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

/** A live knowledge materialization owned by `ownerPid` pauses the upgrade until it settles. */
async function liveMaterialization(root: string, ownerPid: number): Promise<void> {
  await mkdir(resolve(root, MARKER), { recursive: true });
  await writeFile(
    resolve(root, MARKER, "journal.json"),
    `${canonicalJson({
      schemaVersion: 1,
      transactionType: "knowledge_materialization",
      planId: `knormplan_${"e".repeat(24)}`,
      projectId: (await loadProjectManifest(root)).projectId,
      ownerPid,
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
}

/** Another process holds the admission database's write lock for `milliseconds`. */
async function lockAdmissionDatabase(
  directory: string,
  milliseconds: number,
): Promise<{ released: Promise<void> }> {
  const path = resolve(directory, "full-cycle-admission.sqlite");
  const holder = spawn(process.execPath, [
    "-e",
    `const { DatabaseSync } = require("node:sqlite");
     const database = new DatabaseSync(${JSON.stringify(path)});
     database.exec("BEGIN EXCLUSIVE");
     process.stdout.write("locked\\n");
     setTimeout(() => { database.exec("COMMIT"); database.close(); }, ${milliseconds});`,
  ]);
  children.push(holder);
  const released = new Promise<void>((done) => holder.once("exit", () => done()));
  await new Promise((locked) => holder.stdout.once("data", locked));
  return { released };
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
    // A live materialization pauses the apply mid-way, which is where a resident cycle would
    // otherwise start; the observation runs at that point.
    const owner = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    children.push(owner);
    await liveMaterialization(root, owner.pid!);
    const admittedDuringApply: boolean[] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runCli(["upgrade", "--apply", "--json"], io(root, stdout, stderr), {
      knowledgeCycleAdmission: { directory },
      knowledgeMaterializationWait: {
        now: () => 0,
        sleep: async () => {
          admittedDuringApply.push(await residentCycleAdmitted(directory, root));
          await rm(resolve(root, MARKER), { recursive: true });
        },
      },
    });
    expect(code, stdout.join("") + stderr.join("")).toBe(0);
    expect(admittedDuringApply).toEqual([false]);
    // The release removed the holder row itself, not only let its lease lapse.
    const db = new DatabaseSync(resolve(directory, "full-cycle-admission.sqlite"));
    try {
      expect(db.prepare("SELECT COUNT(*) AS count FROM holder").get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
    expect(await residentCycleAdmitted(directory, root)).toBe(true);
  }, 60_000);

  it("refuses its next stage after a resident was admitted on its lapsed lease (ADR-0577)", async () => {
    const root = await repository();
    const directory = await temporary("lervo-upgrade-admission-");
    const presented = await planId(root);
    const owner = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    children.push(owner);
    await liveMaterialization(root, owner.pid!);
    let resident: Awaited<ReturnType<typeof acquireFullCycleAdmission>> | undefined;
    const stdout: string[] = [];
    const stderr: string[] = [];
    try {
      const code = await runCli(["upgrade", "--apply", "--json"], io(root, stdout, stderr), {
        knowledgeCycleAdmission: { directory },
        knowledgeMaterializationWait: {
          now: () => 0,
          // The in-exclusion plan stalls here. A renewal timer blocked past the lease leaves
          // an expired row, and a waiting resident takes the slot.
          sleep: async () => {
            const db = new DatabaseSync(resolve(directory, "full-cycle-admission.sqlite"));
            db.prepare("UPDATE holder SET expires_at=?").run(Date.now() - 1);
            db.close();
            resident = await acquireFullCycleAdmission({
              repositoryRoot: resolve(root, "resident-repository"),
              directory,
              pollMilliseconds: 10,
              signal: AbortSignal.timeout(5_000),
            });
            await rm(resolve(root, MARKER), { recursive: true });
          },
        },
      });
      expect(code, stdout.join("") + stderr.join("")).toBe(1);
    } finally {
      await resident?.release();
    }
    expect(resident).toBeDefined();
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      error: {
        code: "knowledge_cycle_admission_lost",
        phase: "before_stage",
        nextStage: "terminal_worker_entry",
        appliedStages: [],
      },
    });
    expect(await planId(root)).toBe(presented);
  }, 60_000);

  it("reports every applied stage when the admission is lost after the last stage (ADR-0577)", async () => {
    const root = await temporary("lervo-upgrade-exclusion-");
    const directory = await temporary("lervo-upgrade-admission-");
    let resident: Awaited<ReturnType<typeof acquireFullCycleAdmission>> | undefined;
    try {
      await expect(
        withKnowledgeResidentExclusion(
          { repositoryRoot: root, io: { stderr: () => undefined }, options: { directory } },
          async (exclusion) => {
            await exclusion.assertHeld({ nextStage: "knowledge", appliedStages: [] });
            // The last stage stalls past the lease, and a resident takes the slot.
            const db = new DatabaseSync(resolve(directory, "full-cycle-admission.sqlite"));
            db.prepare("UPDATE holder SET expires_at=?").run(Date.now() - 1);
            db.close();
            resident = await acquireFullCycleAdmission({
              repositoryRoot: resolve(root, "resident-repository"),
              directory,
              pollMilliseconds: 10,
              signal: AbortSignal.timeout(5_000),
            });
            await exclusion.assertHeld({
              nextStage: null,
              appliedStages: ["knowledge", "repository_node"],
            });
          },
        ),
      ).rejects.toMatchObject({
        code: "knowledge_cycle_admission_lost",
        message: expect.stringContaining("during or after its last stage"),
        details: { phase: "after_last_stage", appliedStages: ["knowledge", "repository_node"] },
      });
    } finally {
      await resident?.release();
    }
    expect(resident).toBeDefined();
  }, 60_000);

  it("reports an unconfirmed admission, not a lost one, while the database stays locked (ADR-0577)", async () => {
    const root = await temporary("lervo-upgrade-exclusion-");
    const directory = await temporary("lervo-upgrade-admission-");
    let released: Promise<void> | undefined;
    await expect(
      withKnowledgeResidentExclusion(
        {
          repositoryRoot: root,
          io: { stderr: () => undefined },
          options: { directory, pollMilliseconds: 10, confirmContentionWaitMilliseconds: 100 },
        },
        async (exclusion) => {
          ({ released } = await lockAdmissionDatabase(directory, 6_500));
          await exclusion.assertHeld({ nextStage: "node", appliedStages: ["knowledge"] });
        },
      ),
    ).rejects.toMatchObject({
      code: "knowledge_cycle_admission_unconfirmed",
      details: { phase: "before_stage", nextStage: "node", appliedStages: ["knowledge"] },
    });
    await released;
  }, 60_000);

  it("waits for a running resident cycle to finish before applying", async () => {
    const root = await repository();
    const directory = await temporary("lervo-upgrade-admission-");
    const presented = await planId(root);
    const cycle = await acquireFullCycleAdmission({
      repositoryRoot: root,
      directory,
      signal: AbortSignal.timeout(1_000),
    });
    const release = setTimeout(() => void cycle.release(), 300);
    const stdout: string[] = [];
    const stderr: string[] = [];
    try {
      const code = await runCli(["upgrade", "--apply", "--json"], io(root, stdout, stderr), {
        knowledgeCycleAdmission: { directory, pollMilliseconds: 20 },
      });
      expect(code, stdout.join("") + stderr.join("")).toBe(0);
    } finally {
      clearTimeout(release);
      await cycle.release();
    }
    expect(stderr.join("")).toContain(
      "Waiting up to 15 min for the running background knowledge cycle on this host to stop at its next stage boundary before upgrading.",
    );
    expect(JSON.parse(stdout.join(""))).toMatchObject({ planId: presented });
  }, 60_000);

  it("goes ahead of a resident cycle that waited first, which runs after the upgrade (ADR-0574)", async () => {
    const root = await repository();
    const directory = await temporary("lervo-upgrade-admission-");
    const signal = AbortSignal.timeout(60_000);
    const cycle = await acquireFullCycleAdmission({
      repositoryRoot: resolve(root, "running-repository"),
      directory,
      signal,
    });
    // ADR-0602: a release wakes the next waiter at once, so the order is read from the upgrade's
    // own effect on disk rather than from when the CLI call returned.
    const presented = await planId(root);
    let residentAfterUpgrade: boolean | null = null;
    const resident = acquireFullCycleAdmission({
      repositoryRoot: resolve(root, "waiting-repository"),
      directory,
      pollMilliseconds: 10,
      signal,
    }).then(async (admission) => {
      residentAfterUpgrade = (await planId(root)) !== presented;
      await admission.release();
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    const release = setTimeout(() => void cycle.release(), 300);
    const stdout: string[] = [];
    const stderr: string[] = [];
    try {
      const code = await runCli(["upgrade", "--apply", "--json"], io(root, stdout, stderr), {
        knowledgeCycleAdmission: { directory, pollMilliseconds: 20 },
      });
      expect(code, stdout.join("") + stderr.join("")).toBe(0);
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
    const presented = await planId(root);
    const cycle = await acquireFullCycleAdmission({
      repositoryRoot: root,
      directory,
      signal: AbortSignal.timeout(1_000),
    });
    const stdout: string[] = [];
    try {
      const code = await runCli(["upgrade", "--apply", "--json"], io(root, stdout, []), {
        knowledgeCycleAdmission: { directory, pollMilliseconds: 20, waitMs: 200 },
      });
      expect(code).toBe(1);
    } finally {
      await cycle.release();
    }
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      error: { code: "knowledge_cycle_admission_wait_expired" },
    });
    expect(await planId(root)).toBe(presented);
  }, 60_000);
});
