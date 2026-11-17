import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runRepositoryPass } from "../src/host-repository-pass.js";
import {
  createLinkedCliUpgradeRunner,
  parseRepositoryUpgradeOutput,
  type RepositoryUpgradeInvocation,
  type RepositoryUpgradeRunner,
} from "../src/host-repository-upgrade-runner.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const result = (
  status: string,
  fields: Partial<Extract<RepositoryUpgradeInvocation, { kind: "result" }>> = {},
): RepositoryUpgradeInvocation => ({
  kind: "result",
  status,
  planId: null,
  applicableStages: [],
  appliedStages: [],
  pendingStages: [],
  timing: null,
  ...fields,
});

/** Answers each invocation from a per-repository script, recording every argument list. */
function scriptedRunner(
  scripts: Record<string, RepositoryUpgradeInvocation[]>,
  calls: string[][] = [],
): RepositoryUpgradeRunner {
  return async (args) => {
    calls.push([...args]);
    const next = scripts[args[2] as string]?.shift();
    if (next === undefined) throw new Error(`unexpected call ${args.join(" ")}`);
    return next;
  };
}

const pass = (
  roots: string[],
  scripts: Record<string, RepositoryUpgradeInvocation[]>,
  calls: string[][] = [],
) => runRepositoryPass(roots, { run: scriptedRunner(scripts, calls) });

const readinessTimeout: RepositoryUpgradeInvocation = {
  kind: "failed",
  code: "node_fleet_readiness_timeout",
};

describe("runRepositoryPass", () => {
  it("plans, applies the exact plan, and falls back to --safe when the plan changed", async () => {
    const calls: string[][] = [];
    const result_ = await pass(
      ["/r/one", "/r/two"],
      {
        "/r/one": [
          result("ready", { planId: "plan_1" }),
          { kind: "failed", code: "upgrade_plan_changed" },
          result("current", {
            appliedStages: ["repository_node"],
            timing: { admissionWaitMs: 4_000, applyMs: 9_000 },
          }),
        ],
        "/r/two": [result("current")],
      },
      calls,
    );
    expect(result_.outcome).toBe("current");
    expect(result_.repositories[0]).toMatchObject({
      outcome: "current",
      rounds: 1,
      appliedStages: ["repository_node"],
      waitMs: 4_000,
      applyMs: 9_000,
    });
    expect(result_.repositories[1]).toMatchObject({ waitMs: null, applyMs: null });
    expect(calls).toEqual([
      ["upgrade", "--root", "/r/one", "--json"],
      ["upgrade", "--root", "/r/one", "--apply", "--approval", "plan_1", "--json"],
      ["upgrade", "--root", "/r/one", "--apply", "--safe", "--json"],
      ["upgrade", "--root", "/r/two", "--json"],
    ]);
  });

  it("repeats bounded rounds while the plan stays ready and reports content blocks", async () => {
    const result_ = await pass(["/r/one", "/r/two", "/r/three"], {
      "/r/one": [
        result("ready", { planId: "plan_1" }),
        result("ready"),
        result("ready", { planId: "plan_2" }),
        result("current"),
      ],
      "/r/two": [result("blocked")],
      "/r/three": [
        result("pending_authority"),
        { kind: "failed", code: "upgrade_owner_approval_required" },
      ],
    });
    expect(
      result_.repositories.map((repository) => [repository.outcome, repository.rounds]),
    ).toEqual([
      ["current", 2],
      ["blocked", 1],
      ["blocked", 1],
    ]);
    expect(result_.repositories[1]?.code).toBe("upgrade_plan_blocked");
    expect(result_.outcome).toBe("blocked");
  });

  it("goes on to the next round after a failed apply, as upgrade-all.sh does", async () => {
    const result_ = await pass(["/r/one"], {
      "/r/one": [
        result("ready", { planId: "plan_1" }),
        { kind: "failed", code: "knowledge_cycle_admission_wait_expired" },
        result("ready", { planId: "plan_2" }),
        result("current"),
      ],
    });
    expect(result_.repositories[0]).toMatchObject({ outcome: "current", rounds: 2 });
  });

  it("believes a host failure only when it repeats, then stops the pass", async () => {
    const once = await pass(["/r/one"], {
      "/r/one": [
        result("ready", { planId: "plan_1" }),
        readinessTimeout,
        result("ready", { planId: "plan_2" }),
        result("current"),
      ],
    });
    expect(once.repositories[0]).toMatchObject({ outcome: "current", rounds: 2 });
    const twice = await pass(["/r/one", "/r/two"], {
      "/r/one": [
        result("ready", { planId: "plan_1" }),
        readinessTimeout,
        result("ready", { planId: "plan_2" }),
        readinessTimeout,
      ],
      "/r/two": [result("current")],
    });
    expect(twice.outcome).toBe("host_failure");
    expect(twice.repositories).toHaveLength(1);
    expect(twice.repositories[0]?.code).toBe("node_fleet_readiness_timeout");
  });

  it("leaves a blocked repository alone while its plan is unchanged", async () => {
    const calls: string[][] = [];
    const result_ = await runRepositoryPass(["/r/one"], {
      run: scriptedRunner(
        { "/r/one": [result("blocked", { planId: "plan_b", applicableStages: ["node"] })] },
        calls,
      ),
      blockedPlanIds: new Map([["/r/one", "plan_b"]]),
    });
    expect(result_.repositories[0]).toMatchObject({
      outcome: "blocked",
      code: "upgrade_plan_unchanged",
    });
    expect(calls).toHaveLength(1);
  });

  it("stops without a result when a run is interrupted or the stop signal is set", async () => {
    const interrupted = await pass(["/r/one", "/r/two"], {
      "/r/one": [result("ready", { planId: "plan_1" }), { kind: "interrupted" }],
    });
    expect(interrupted).toEqual({ outcome: "interrupted", repositories: [] });
    const controller = new AbortController();
    controller.abort();
    expect(
      await runRepositoryPass(["/r/one"], { run: scriptedRunner({}), signal: controller.signal }),
    ).toEqual({ outcome: "interrupted", repositories: [] });
  });

  it("gives up after five rounds without converging", async () => {
    const script: RepositoryUpgradeInvocation[] = [];
    for (let round = 0; round < 5; round += 1)
      script.push(result("ready", { planId: `plan_${round}` }), result("ready"));
    const result_ = await pass(["/r/one"], { "/r/one": script });
    expect(result_.repositories[0]).toMatchObject({
      outcome: "failed",
      rounds: 5,
      code: "host_follow_repository_upgrade_unconverged",
    });
  });
});

describe("the linked lervo runner", () => {
  it("reads plans, receipts with timing, and error envelopes, and nothing else", () => {
    expect(
      parseRepositoryUpgradeOutput(
        JSON.stringify({
          status: "blocked",
          planId: "p",
          applicableStages: ["node"],
          pending: [{ stage: "knowledge" }],
        }),
      ),
    ).toEqual(
      result("blocked", { planId: "p", applicableStages: ["node"], pendingStages: ["knowledge"] }),
    );
    expect(
      parseRepositoryUpgradeOutput(
        JSON.stringify({
          status: "ready",
          nextPlanId: "n",
          timing: { admissionWaitMs: 1, applyMs: 2 },
        }),
      ),
    ).toEqual(result("ready", { planId: "n", timing: { admissionWaitMs: 1, applyMs: 2 } }));
    expect(
      parseRepositoryUpgradeOutput(
        JSON.stringify({ status: "failed", error: { code: "node_fleet_readiness_timeout" } }),
      ),
    ).toEqual({ kind: "failed", code: "node_fleet_readiness_timeout" });
    expect(parseRepositoryUpgradeOutput("Segmentation fault")).toEqual({ kind: "unreadable" });
    expect(parseRepositoryUpgradeOutput("[]")).toEqual({ kind: "unreadable" });
  });

  it("judges output, not exit status, and reports a signal death or a stop as interrupted", async () => {
    const directory = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-follow-runner-")));
    directories.push(directory);
    const executable = resolve(directory, "lervo");
    await writeFile(
      executable,
      [
        "#!/bin/sh",
        'if [ "$3" = "/broken" ]; then echo crash >&2; exit 2; fi',
        'if [ "$3" = "/killed" ]; then kill -TERM $$; sleep 5; fi',
        'if [ "$3" = "/slow" ]; then sleep 30; fi',
        `echo '{"status":"blocked","applicableStages":[]}'`,
        "exit 1",
        "",
      ].join("\n"),
    );
    await chmod(executable, 0o755);
    const run = createLinkedCliUpgradeRunner(executable, process.env);
    await expect(run(["upgrade", "--root", "/ok", "--json"])).resolves.toMatchObject({
      kind: "result",
      status: "blocked",
    });
    await expect(run(["upgrade", "--root", "/broken", "--json"])).resolves.toEqual({
      kind: "unreadable",
    });
    // A service stop, logout, or the OOM killer: the release is not to blame.
    await expect(run(["upgrade", "--root", "/killed", "--json"])).resolves.toEqual({
      kind: "interrupted",
    });
    const controller = new AbortController();
    const slow = run(["upgrade", "--root", "/slow", "--json"], controller.signal);
    setTimeout(() => controller.abort(), 200);
    await expect(slow).resolves.toEqual({ kind: "interrupted" });
  });
});
