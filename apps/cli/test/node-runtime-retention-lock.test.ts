import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { ProcessObservation } from "@lervo/node-work-admission";
import { afterEach, describe, expect, it } from "vitest";

import {
  isRuntimeLockBusy,
  withNodeRuntimeRetentionLock,
} from "../src/node-runtime-retention-lock.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function directory(): Promise<string> {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-runtime-lock-")));
  roots.push(root);
  return root;
}

const birth = (digit: string) => `proc_test_v1:sha256:${digit.repeat(64)}`;
// pid 1 always runs and never belongs to the test, like a pid reused after a WSL restart.
const LIVE_FOREIGN_PID = 1;

describe("runtime lock holder birth identity (ADR-0573)", () => {
  const birthOf = (identity: string | null): ProcessObservation =>
    identity === null ? { status: "unknown" } : { status: "present", identity };
  const acquire = (lock: string, observed: ProcessObservation) =>
    withNodeRuntimeRetentionLock(lock, async () => readFile(lock, "utf8"), {
      observeProcess: (pid) =>
        pid === process.pid ? { status: "present", identity: birth("f") } : observed,
    });

  it("records the holder's birth identity beside its pid", async () => {
    const lock = resolve(await directory(), ".retention.lock");
    await expect(acquire(lock, birthOf(null))).resolves.toBe(`${process.pid}\n${birth("f")}\n`);
  });

  it("frees a lock whose live pid now has a different birth", async () => {
    const lock = resolve(await directory(), ".retention.lock");
    await writeFile(lock, `${LIVE_FOREIGN_PID}\n${birth("a")}\n`, { mode: 0o600 });
    await expect(acquire(lock, birthOf(birth("b")))).resolves.toBe(
      `${process.pid}\n${birth("f")}\n`,
    );
  });

  it("keeps a lock whose holder still runs, could not be observed, or wrote only a pid", async () => {
    const lock = resolve(await directory(), ".retention.lock");
    for (const [content, observed] of [
      [`${LIVE_FOREIGN_PID}\n${birth("a")}\n`, birthOf(birth("a"))],
      [`${LIVE_FOREIGN_PID}\n${birth("a")}\n`, birthOf(null)],
      // Another identity scheme proves nothing about reuse.
      [`${LIVE_FOREIGN_PID}\n${birth("a")}\n`, birthOf(`proc_other_v2:sha256:${"b".repeat(64)}`)],
      // A lock from an older CLI holds only a pid and is judged by that pid, as before.
      [String(LIVE_FOREIGN_PID), birthOf(birth("b"))],
    ] as Array<[string, ProcessObservation]>) {
      await writeFile(lock, content, { mode: 0o600 });
      const refused = await acquire(lock, observed).catch((error: unknown) => error);
      expect(isRuntimeLockBusy(refused)).toBe(true);
      expect(await readFile(lock, "utf8")).toBe(content);
    }
  });

  it("refuses a malformed holder without removing it", async () => {
    const lock = resolve(await directory(), ".retention.lock");
    await writeFile(lock, `${LIVE_FOREIGN_PID}\nnot-an-identity\n`, { mode: 0o600 });
    await expect(acquire(lock, birthOf(null))).rejects.toThrow("Invalid runtime lock owner.");
    expect(await readFile(lock, "utf8")).toBe(`${LIVE_FOREIGN_PID}\nnot-an-identity\n`);
  });
});
