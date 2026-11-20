import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { inspectIdleTimers } from "../lib/idle-timers.mjs";

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), "lervo-idle-timers-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

const allowlist = (entries = []) => ({ schemaVersion: 2, scope: ["service/src"], entries });

describe("idle timer guard (ADR-0602)", () => {
  it("rejects an interval, a re-arming timer, a sleeping loop and a named poll period", async () => {
    const repositoryRoot = await fixture({
      "service/src/interval.ts": "setInterval(() => undefined, 1_000);\n",
      "service/src/rearm.ts":
        "function check() {\n  read();\n  timer = setTimeout(check, 1_000);\n}\nconst again = () => {\n  timer = setTimeout(() => again(), 15_000);\n};\n",
      "service/src/loop.ts":
        "export async function wait() {\n  for (;;) {\n    if (ready()) return;\n    await sleep(1_000);\n  }\n}\nwhile (busy()) {\n  await new Promise((r) => setTimeout(r, 50));\n}\n",
      "service/src/period.ts":
        "export const HEAD_POLL_MILLISECONDS = 30_000;\nloop({ intervalMs: 60_000 });\n",
    });
    const result = await inspectIdleTimers({ repositoryRoot, allowlist: allowlist() });
    expect(result.issues).toEqual([
      "service/src/interval.ts adds a interval timer; wait on a change signal or one deadline, or list it with a reason.",
      "service/src/loop.ts adds a loop timer; wait on a change signal or one deadline, or list it with a reason.",
      "service/src/period.ts sets the period HEAD_POLL_MILLISECONDS; wait on a change signal or one deadline, or list it with a reason.",
      "service/src/period.ts sets the period intervalMs; wait on a change signal or one deadline, or list it with a reason.",
      "service/src/rearm.ts adds a rearm timer; wait on a change signal or one deadline, or list it with a reason.",
    ]);
    const counts = await inspectIdleTimers({
      repositoryRoot,
      allowlist: allowlist([
        {
          path: "service/src/rearm.ts",
          kind: "rearm",
          count: 1,
          reason: "Listed with a wrong count.",
        },
        { path: "service/src/loop.ts", kind: "loop", count: 2, reason: "Two bounded waits here." },
      ]),
    });
    expect(counts.issues).toContain(
      "service/src/rearm.ts has 2 rearm timers; the allowlist expects 1.",
    );
    expect(counts.issues.join("\n")).not.toContain("service/src/loop.ts");
  });

  it("follows calls within a module and counts immediate and next-tick loops", async () => {
    const repositoryRoot = await fixture({
      "service/src/mutual.ts":
        "function arm() {\n  timer = setTimeout(() => fire(), 1_000);\n}\nfunction fire() {\n  read();\n  arm();\n}\n",
      "service/src/immediate.ts":
        "const spin = () => {\n  setImmediate(spin);\n};\nfunction again() {\n  process.nextTick(() => again());\n}\nwhile (busy()) {\n  queueMicrotask(check);\n}\n",
    });
    const result = await inspectIdleTimers({ repositoryRoot, allowlist: allowlist() });
    expect(result.issues).toEqual([
      "service/src/immediate.ts adds a rearm timer; wait on a change signal or one deadline, or list it with a reason.",
      "service/src/immediate.ts adds a loop timer; wait on a change signal or one deadline, or list it with a reason.",
      "service/src/mutual.ts adds a rearm timer; wait on a change signal or one deadline, or list it with a reason.",
    ]);
    const counts = await inspectIdleTimers({
      repositoryRoot,
      allowlist: allowlist([
        {
          path: "service/src/immediate.ts",
          kind: "rearm",
          count: 2,
          reason: "Two re-arming calls.",
        },
        { path: "service/src/immediate.ts", kind: "loop", count: 1, reason: "One looping call." },
        { path: "service/src/mutual.ts", kind: "rearm", count: 1, reason: "A mutual re-arm." },
      ]),
    });
    expect(counts.issues).toEqual([]);
  });

  it("accepts one-shot timers, listed exceptions, tests and prose, and flags stale entries", async () => {
    const repositoryRoot = await fixture({
      "service/src/debounce.ts":
        "const signal = () => {\n  debounce = setTimeout(() => {\n    debounce = undefined;\n    check();\n  }, 50);\n};\n",
      "service/src/lease.ts": "// setInterval in prose is not code\nsetInterval(renew, 10_000);\n",
      "service/src/watch.test.ts": "setInterval(() => undefined, 1);\n",
      "service/test/helper.ts": "setInterval(() => undefined, 1);\n",
    });
    const lease = {
      path: "service/src/lease.ts",
      kind: "interval",
      count: 1,
      reason: "Lease renewal while held.",
    };
    const accepted = await inspectIdleTimers({ repositoryRoot, allowlist: allowlist([lease]) });
    expect(accepted.issues).toEqual([]);
    const stale = await inspectIdleTimers({
      repositoryRoot,
      allowlist: allowlist([
        lease,
        {
          path: "service/src/gone.ts",
          kind: "period",
          name: "GONE_POLL_MS",
          reason: "Removed long ago.",
        },
        { path: "service/src/lease.ts", kind: "loop", count: 1, reason: "x" },
      ]),
    });
    expect(stale.issues).toEqual([
      "service/src/lease.ts needs a reason in the idle-timer allowlist.",
      "service/src/gone.ts no longer has the period GONE_POLL_MS timer; remove its allowlist entry.",
      "service/src/lease.ts no longer has the loop timer; remove its allowlist entry.",
    ]);
  });
});
