import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertNoKnowledgeMaterializationTransaction,
  canonicalJson,
  createKnowledgeMaterializationSettlement,
  describeKnowledgeMaterializationOwner,
  KNOWLEDGE_MATERIALIZATION_RECOVERY_COMMAND,
  KNOWLEDGE_MATERIALIZATION_SETTLE_WAIT_MS,
} from "../src/index.js";

const MARKER = ".lervo/state/knowledge/materialization-transaction";
const PLAN_ID = `knormplan_${"a".repeat(24)}`;
const roots: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-materialization-settlement-"));
  roots.push(root);
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

async function writeMarker(root: string, ownerPid: number): Promise<string> {
  const journal = resolve(root, MARKER, "journal.json");
  await mkdir(resolve(root, MARKER), { recursive: true });
  await writeFile(
    journal,
    `${canonicalJson({
      schemaVersion: 1,
      transactionType: "knowledge_materialization",
      planId: PLAN_ID,
      projectId: "prj_settlement",
      ownerPid,
      phase: "event_recording",
      publishedCount: 1,
      activeIndex: null,
      operations: [
        {
          path: "README.md",
          action: "create",
          beforeHash: null,
          afterHash: `sha256:${"b".repeat(64)}`,
        },
      ],
    })}\n`,
  );
  return journal;
}

/** A clock that only moves when the settlement sleeps. */
function fakeTime(onSleep: (call: number) => Promise<void> | void = () => undefined) {
  let current = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => current,
    sleep: async (durationMs: number) => {
      sleeps.push(durationMs);
      current += durationMs;
      await onSleep(sleeps.length);
    },
  };
}

describe("knowledge materialization settlement", () => {
  it("waits for a live owner to settle and then runs the operation", async () => {
    const root = await repository();
    const ownerPid = liveProcess();
    await writeMarker(root, ownerPid);
    const time = fakeTime(async (call) => {
      if (call === 3) await rm(resolve(root, MARKER), { recursive: true });
    });
    const notices: string[] = [];
    let runs = 0;
    const settlement = createKnowledgeMaterializationSettlement({
      repositoryRoot: root,
      ...time,
      onWait: (owner) => notices.push(`${owner.ownerPid}:${owner.planId}:${owner.phase}`),
    });

    await expect(settlement.run(async () => (runs += 1))).resolves.toBe(1);
    expect(time.sleeps).toEqual([2_000, 2_000, 2_000]);
    expect(notices).toEqual([`${ownerPid}:${PLAN_ID}:event_recording`]);
  });

  it("names the live owner when it does not settle within the wait and leaves its marker", async () => {
    const root = await repository();
    const ownerPid = liveProcess();
    const journal = await writeMarker(root, ownerPid);
    const before = await readFile(journal, "utf8");
    const time = fakeTime();
    let runs = 0;
    const settlement = createKnowledgeMaterializationSettlement({ repositoryRoot: root, ...time });

    const failure = settlement.run(async () => (runs += 1));
    await expect(failure).rejects.toMatchObject({
      code: "knowledge_materialization_wait_expired",
    });
    await expect(failure).rejects.toThrow(
      `process ${ownerPid} (plan ${PLAN_ID}, phase event_recording) did not settle within 15 minutes`,
    );
    expect(runs).toBe(0);
    expect(time.sleeps.reduce((total, value) => total + value, 0)).toBe(
      KNOWLEDGE_MATERIALIZATION_SETTLE_WAIT_MS,
    );
    expect(await readFile(journal, "utf8")).toBe(before);
  });

  it("refuses an interrupted marker immediately with the recovery command", async () => {
    const root = await repository();
    const journal = await writeMarker(root, await exitedProcess());
    const before = await readFile(journal, "utf8");
    const time = fakeTime();
    let runs = 0;
    const settlement = createKnowledgeMaterializationSettlement({ repositoryRoot: root, ...time });

    const failure = settlement.run(async () => (runs += 1));
    await expect(failure).rejects.toMatchObject({ code: "knowledge_recovery_required" });
    await expect(failure).rejects.toThrow(KNOWLEDGE_MATERIALIZATION_RECOVERY_COMMAND);
    expect(runs).toBe(0);
    expect(time.sleeps).toEqual([]);
    expect(await readFile(journal, "utf8")).toBe(before);
  });

  it("runs again when a live owner refuses the operation after a settled observation", async () => {
    const root = await repository();
    const ownerPid = liveProcess();
    const time = fakeTime(async () => {
      await rm(resolve(root, MARKER), { recursive: true });
    });
    const settlement = createKnowledgeMaterializationSettlement({ repositoryRoot: root, ...time });
    let runs = 0;

    const value = await settlement.run(async () => {
      runs += 1;
      if (runs === 1) {
        await writeMarker(root, ownerPid);
        await assertNoKnowledgeMaterializationTransaction({ repositoryRoot: root });
      }
      return runs;
    });
    expect(value).toBe(2);
    expect(time.sleeps).toEqual([2_000]);

    let planned = 0;
    await writeMarker(root, ownerPid);
    const refused = await settlement.run(
      async () => (planned += 1),
      (attempt) => attempt === 1,
    );
    expect(refused).toBe(2);
  });

  it("distinguishes live and interrupted owners in the immediate refusal", async () => {
    const root = await repository();
    const ownerPid = liveProcess();
    await writeMarker(root, ownerPid);
    await expect(describeKnowledgeMaterializationOwner({ repositoryRoot: root })).resolves.toEqual({
      state: "live",
      ownerPid,
      planId: PLAN_ID,
      phase: "event_recording",
    });
    await expect(
      assertNoKnowledgeMaterializationTransaction({ repositoryRoot: root }),
    ).rejects.toThrow(`A live knowledge materialization owned by process ${ownerPid}`);

    await writeMarker(root, await exitedProcess());
    await expect(
      assertNoKnowledgeMaterializationTransaction({ repositoryRoot: root }),
    ).rejects.toThrow(KNOWLEDGE_MATERIALIZATION_RECOVERY_COMMAND);
  });
});
