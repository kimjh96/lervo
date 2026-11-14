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

it("bounds scope names and subcommands", () => {
  const observation = observed();
  for (let index = 0; index < 280; index++)
    withProcessCostScope(`scope_${index}`, () => recordSynchronousGitProcess([`sub${index}`]));
  withProcessCostScope("scope_0", () => {
    for (let index = 0; index < 60; index++) recordSynchronousGitProcess([`command-${index}`]);
    recordSynchronousGitProcess(["-C", "/x", "/absolute/path"]);
  });
  const snapshot = observation.snapshot();
  expect(snapshot.gitProcesses).toBe(341);
  expect(Object.keys(snapshot.scopes)).toHaveLength(257);
  expect(snapshot.scopes.other!.calls).toBe(24);
  expect(Object.keys(snapshot.scopes.scope_0!.gitProcesses)).toHaveLength(49);
  expect(snapshot.scopes.scope_0!.gitProcesses.other).toBe(14);
});
