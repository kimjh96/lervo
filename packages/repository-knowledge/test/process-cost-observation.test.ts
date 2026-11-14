import { execFile, execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, expect, it } from "vitest";

import {
  measureProcessCost,
  observeProcessCost,
  recordSynchronousGitProcess,
  withProcessCostScope,
} from "../src/process-cost-observation.js";

const execute = promisify(execFile);
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-process-cost-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root]);
  return root;
}

function observed() {
  const observation = observeProcessCost();
  cleanups.push(() => observation.close());
  return observation;
}

it("counts every Git process by scope and subcommand, past global options", async () => {
  const root = await repository();
  const observation = observed();
  await withProcessCostScope("outer", async () => {
    await execute("git", ["-C", root, "-c", "core.quotePath=false", "rev-parse", "HEAD"]).catch(
      () => undefined,
    );
    await withProcessCostScope("inner", async () => {
      await execute("git", ["--no-optional-locks", "-C", root, "status", "--porcelain"]);
      await new Promise((settled) =>
        spawn("git", ["-C", root, "ls-files"], { stdio: "ignore" }).on("close", settled),
      );
    });
    recordSynchronousGitProcess(["-C", root, "diff", "--name-only"]);
    execFileSync("git", ["-C", root, "diff", "--name-only"]);
  });
  await execute("node", ["--version"]);
  await execute("git", ["--version"]);
  const snapshot = observation.snapshot();
  expect(snapshot.gitProcesses).toBe(5);
  expect(snapshot.scopes.outer!.gitProcesses).toEqual({ "rev-parse": 1, diff: 1 });
  expect(snapshot.scopes["outer/inner"]!.gitProcesses).toEqual({ status: 1, "ls-files": 1 });
  expect(snapshot.scopes.unscoped!.gitProcesses).toEqual({ other: 1 });
  expect(snapshot.scopes.outer!.calls).toBe(1);
  expect(snapshot.scopes["outer/inner"]!.calls).toBe(1);
  expect(snapshot.scopes.outer!.wallMilliseconds).toBeGreaterThanOrEqual(
    snapshot.scopes["outer/inner"]!.wallMilliseconds,
  );
});

it("attributes a measurement only its own async context, including timers it started", async () => {
  const root = await repository();
  const status = () => execute("git", ["-C", root, "status", "--porcelain"]);
  const outside = observed();
  const [measured] = await Promise.all([
    measureProcessCost(async () => {
      await withProcessCostScope("stage", async () => {
        await status();
        await new Promise<void>((done) =>
          setTimeout(() => {
            void withProcessCostScope("poll", status).then(() => done());
          }, 5),
        );
      });
      return "value";
    }),
    status(),
    status(),
  ]);
  expect(measured.value).toBe("value");
  expect(measured.cost.gitProcesses).toBe(2);
  expect(measured.cost.scopes.stage!.gitProcesses).toEqual({ status: 1 });
  expect(measured.cost.scopes["stage/poll"]!.gitProcesses).toEqual({ status: 1 });
  expect(measured.cost.wallMilliseconds).toBeGreaterThanOrEqual(0);
  expect(measured.cost.cpuMicroseconds).toBeGreaterThan(0);
  expect(outside.snapshot().gitProcesses).toBe(4);
});

it("records nothing without an observer and never fails on a label", async () => {
  const root = await repository();
  await withProcessCostScope("stage", () => execute("git", ["-C", root, "status"]));
  const observation = observed();
  expect(observation.snapshot()).toEqual({ gitProcesses: 0, scopes: {} });
  expect(withProcessCostScope("Not A Scope", () => 7)).toBe(7);
  expect(Object.keys(observation.snapshot().scopes)).toEqual(["other"]);
});

const COMMANDS =
  "add apply archive branch bundle cat-file check-attr check-ignore checkout checkout-index cherry cherry-pick clean clone commit commit-tree config describe diff diff-index diff-tree fetch for-each-ref grep hash-object init log ls-files ls-remote ls-tree merge merge-base merge-tree mv notes patch-id prune pull push read-tree remote replace reset restore rev-list rev-parse revert rm show show-ref".split(
    " ",
  );

it("bounds scope names and subcommands", () => {
  const observation = observed();
  for (let index = 0; index < 280; index++)
    withProcessCostScope(`scope_${index}`, () => recordSynchronousGitProcess(["status"]));
  withProcessCostScope("scope_0", () => {
    for (const command of COMMANDS) recordSynchronousGitProcess([command]);
  });
  const snapshot = observation.snapshot();
  expect(COMMANDS).toHaveLength(50);
  expect(snapshot.gitProcesses).toBe(330);
  expect(Object.keys(snapshot.scopes)).toHaveLength(257);
  expect(snapshot.scopes.other!.calls).toBe(24);
  expect(Object.keys(snapshot.scopes.scope_0!.gitProcesses)).toHaveLength(49);
  // `status` came first; 47 more names fit, and the last three overflow.
  expect(snapshot.scopes.scope_0!.gitProcesses.other).toBe(3);
});

it("records only known Git commands, never a value read where a command was expected", () => {
  const observation = observed();
  withProcessCostScope("probe", () => {
    for (const args of [
      ["--shallow-file", "private-project", "rev-parse", "HEAD"],
      ["--super-prefix", "private/", "ls-files"],
      ["--attr-source", "private-tree", "check-attr", "x"],
      ["--config-env", "core.x=PRIVATE", "status"],
      ["--git-dir", "/private/git", "--work-tree", "/private", "--namespace", "n", "log"],
      ["--list-cmds=main"],
      ["-c", "alias.constructor=rev-parse HEAD", "constructor"],
      ["__proto__"],
      ["toString"],
      ["private-project"],
      ["/absolute/path"],
    ])
      recordSynchronousGitProcess(args);
  });
  const counts = observation.snapshot().scopes.probe!.gitProcesses;
  expect({ ...counts }).toEqual({
    "rev-parse": 1,
    "ls-files": 1,
    "check-attr": 1,
    status: 1,
    log: 1,
    other: 6,
  });
  expect(Object.getPrototypeOf(counts)).toBeNull();
  expect(JSON.stringify(observation.snapshot())).not.toMatch(/private|constructor|proto/u);
});

it("keeps report keys from reaching the object prototype", () => {
  const observation = observed();
  for (const name of ["constructor", "toString", "__proto__"])
    withProcessCostScope(name, () => recordSynchronousGitProcess(["status"]));
  const { scopes } = observation.snapshot();
  expect(Object.getPrototypeOf(scopes)).toBeNull();
  expect(Object.keys(scopes).sort()).toEqual(["constructor", "other"]);
  const inherited: string = "constructor";
  expect(scopes[inherited]!.gitProcesses.status).toBe(1);
  expect(scopes.other!.calls).toBe(2);
  expect(({} as Record<string, unknown>).status).toBeUndefined();
});

it("returns the very value `run` returned, including a child process promise", async () => {
  const root = await repository();
  const observation = observed();
  const running = execute("git", ["-C", root, "status"]);
  expect(withProcessCostScope("same", () => running)).toBe(running);
  const wrapped = withProcessCostScope("child", () => execute("git", ["-C", root, "status"]));
  expect(wrapped.child.pid).toEqual(expect.any(Number));
  await Promise.all([running, wrapped]);
  const value = { marker: true };
  expect(withProcessCostScope("sync", () => value)).toBe(value);
  const failure = new Error("rejected");
  const rejecting = Promise.reject(failure);
  expect(withProcessCostScope("rejecting", () => rejecting)).toBe(rejecting);
  await expect(rejecting).rejects.toBe(failure);
  await new Promise((settled) => setImmediate(settled));
  expect(observation.snapshot().scopes.rejecting!.calls).toBe(1);
});

it("settles a synchronous throw, then rethrows the same error", async () => {
  const root = await repository();
  const observation = observed();
  const thrown = (() => {
    try {
      withProcessCostScope("capture", () => {
        recordSynchronousGitProcess(["rev-parse"]);
        execFileSync("git", ["-C", root, "rev-parse", "--verify", "refs/heads/missing"], {
          stdio: "pipe",
        });
      });
    } catch (error) {
      return error;
    }
    return null;
  })();
  expect(thrown).toMatchObject({ status: 128 });
  const capture = observation.snapshot().scopes.capture!;
  expect(capture.calls).toBe(1);
  expect(capture.wallMilliseconds).toBeGreaterThanOrEqual(0);
  expect({ ...capture.gitProcesses }).toEqual({ "rev-parse": 1 });
});
