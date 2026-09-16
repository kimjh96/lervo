import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openUnattendedSchedulerRuntime } from "../src/unattended-scheduler-runtime.js";

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-scheduler-runtime-"));
  roots.push(root);
  await mkdir(resolve(root, ".lervo/state"), { recursive: true });
  return root;
}

describe("unattended scheduler runtime", () => {
  it("wakes a waiting scheduler when the kill switch appears", async () => {
    const root = await repository();
    const runtime = await openUnattendedSchedulerRuntime({
      repositoryRoot: root,
      killSwitchPath: ".lervo/state/scheduler.stop",
    });
    try {
      let awakened = false;
      const waiting = runtime.waitForChange!(30_000).then(() => {
        awakened = true;
      });
      for (let attempt = 0; attempt < 100 && !awakened; attempt += 1) {
        await writeFile(resolve(root, ".lervo/state/scheduler.stop"), `stop ${attempt}\n`);
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      }
      expect(awakened).toBe(true);
      await waiting;
      expect(await runtime.killSwitchEngaged()).toBe(true);
    } finally {
      await runtime.release();
    }
  }, 30_000);

  it("holds one repository scheduler lock and releases only its own lock", async () => {
    const root = await repository();
    const runtime = await openUnattendedSchedulerRuntime({
      repositoryRoot: root,
      killSwitchPath: ".lervo/state/scheduler.stop",
    });

    await expect(
      openUnattendedSchedulerRuntime({
        repositoryRoot: root,
        killSwitchPath: ".lervo/state/scheduler.stop",
      }),
    ).rejects.toThrow("Another unattended scheduler");
    await runtime.release();
    const replacement = await openUnattendedSchedulerRuntime({
      repositoryRoot: root,
      killSwitchPath: ".lervo/state/scheduler.stop",
    });
    await replacement.release();
  });

  it("recovers one same-host dead lock through an exclusive recovery gate", async () => {
    const root = await repository();
    await writeFile(
      resolve(root, ".lervo/state/unattended-scheduler.lock"),
      `${JSON.stringify({
        schemaVersion: 1,
        schedulerSessionId: `ses_scheduler_${"a".repeat(32)}`,
        pid: 2_147_483_647,
        hostname: hostname(),
        startedAt: new Date(0).toISOString(),
      })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );

    const runtime = await openUnattendedSchedulerRuntime({
      repositoryRoot: root,
      killSwitchPath: ".lervo/state/scheduler.stop",
    });
    await runtime.release();
  });

  it("fails closed when another process owns stale-lock recovery", async () => {
    const root = await repository();
    const staleLock = `${JSON.stringify({
      schemaVersion: 1,
      schedulerSessionId: `ses_scheduler_${"a".repeat(32)}`,
      pid: 2_147_483_647,
      hostname: hostname(),
      startedAt: new Date(0).toISOString(),
    })}\n`;
    await writeFile(resolve(root, ".lervo/state/unattended-scheduler.lock"), staleLock, "utf8");
    await writeFile(
      resolve(root, ".lervo/state/unattended-scheduler.lock.recovery"),
      staleLock,
      "utf8",
    );

    await expect(
      openUnattendedSchedulerRuntime({
        repositoryRoot: root,
        killSwitchPath: ".lervo/state/scheduler.stop",
      }),
    ).rejects.toThrow("recovering this repository");
  });

  it("treats any exact in-repository kill-switch entry as engaged", async () => {
    const root = await repository();
    const runtime = await openUnattendedSchedulerRuntime({
      repositoryRoot: root,
      killSwitchPath: ".lervo/state/scheduler.stop",
    });
    expect(await runtime.killSwitchEngaged()).toBe(false);
    await writeFile(resolve(root, ".lervo/state/scheduler.stop"), "stop\n", "utf8");
    expect(await runtime.killSwitchEngaged()).toBe(true);
    await runtime.release();
  });

  it("rejects an escaping kill-switch path at the runtime boundary", async () => {
    const root = await repository();
    await expect(
      openUnattendedSchedulerRuntime({
        repositoryRoot: root,
        killSwitchPath: "../outside.stop",
      }),
    ).rejects.toThrow("repository-relative");
  });
});
