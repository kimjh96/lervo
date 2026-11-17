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

describe("runRepositoryPass", () => {
  it("plans, applies the exact plan, and falls back to --safe when the plan changed", async () => {
    const calls: string[][] = [];
    const pass = await runRepositoryPass(
      ["/r/one", "/r/two"],
      scriptedRunner(
        {
          "/r/one": [
            result("ready", { planId: "plan_1" }),
            { kind: "failed", code: "upgrade_plan_changed" },
            result("current", { appliedStages: ["repository_node"] }),
          ],
          "/r/two": [result("current")],
        },
        calls,
      ),
    );
    expect(pass.outcome).toBe("current");
    expect(pass.repositories[0]).toMatchObject({
      outcome: "current",
      rounds: 1,
      appliedStages: ["repository_node"],
    });
    expect(calls).toEqual([
      ["upgrade", "--root", "/r/one", "--json"],
      ["upgrade", "--root", "/r/one", "--apply", "--approval", "plan_1", "--json"],
      ["upgrade", "--root", "/r/one", "--apply", "--safe", "--json"],
      ["upgrade", "--root", "/r/two", "--json"],
    ]);
  });

  it("repeats bounded rounds while the plan stays ready and reports content blocks", async () => {
    const pass = await runRepositoryPass(
      ["/r/one", "/r/two", "/r/three"],
      scriptedRunner({
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
      }),
    );
    expect(pass.repositories.map((repository) => [repository.outcome, repository.rounds])).toEqual([
      ["current", 2],
      ["blocked", 1],
      ["blocked", 1],
    ]);
    expect(pass.repositories[1]?.code).toBe("upgrade_plan_blocked");
    expect(pass.outcome).toBe("blocked");
  });

  it("stops at the first host failure, since every later repository runs the same CLI", async () => {
    const pass = await runRepositoryPass(
      ["/r/one", "/r/two"],
      scriptedRunner({
        "/r/one": [
          result("ready", { planId: "plan_1" }),
          { kind: "failed", code: "node_fleet_readiness_timeout" },
        ],
        "/r/two": [result("current")],
      }),
    );
    expect(pass.outcome).toBe("host_failure");
    expect(pass.repositories).toHaveLength(1);
    expect(pass.repositories[0]?.code).toBe("node_fleet_readiness_timeout");
  });

  it("gives up after five rounds without converging", async () => {
    const script: RepositoryUpgradeInvocation[] = [];
    for (let round = 0; round < 5; round += 1)
      script.push(result("ready", { planId: `plan_${round}` }), result("ready"));
    const pass = await runRepositoryPass(["/r/one"], scriptedRunner({ "/r/one": script }));
    expect(pass.repositories[0]).toMatchObject({
      outcome: "failed",
      rounds: 5,
      code: "host_follow_repository_upgrade_unconverged",
    });
  });
});

describe("parseRepositoryUpgradeOutput", () => {
  it("reads plans, receipts, and error envelopes, and nothing else", () => {
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
        JSON.stringify({ status: "failed", error: { code: "node_fleet_readiness_timeout" } }),
      ),
    ).toEqual({ kind: "failed", code: "node_fleet_readiness_timeout" });
    expect(parseRepositoryUpgradeOutput("Segmentation fault")).toEqual({ kind: "unreadable" });
    expect(parseRepositoryUpgradeOutput("[]")).toEqual({ kind: "unreadable" });
  });

  it("runs the linked CLI and judges its output, not its exit status", async () => {
    const directory = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-follow-runner-")));
    directories.push(directory);
    const executable = resolve(directory, "lervo");
    await writeFile(
      executable,
      `#!/bin/sh\nif [ "$3" = "/broken" ]; then echo crash >&2; exit 2; fi\necho '{"status":"blocked","applicableStages":[]}'\nexit 1\n`,
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
  });
});
