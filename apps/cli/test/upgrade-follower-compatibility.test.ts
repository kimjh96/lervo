import { mkdtempSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseRepositoryUpgradeOutput } from "../src/host-repository-upgrade-runner.js";
import { runCli as runUnisolatedCli } from "../src/main.js";
import { withIsolatedUpgradeHost } from "./upgrade-host-isolation.js";

const runCli = withIsolatedUpgradeHost(runUnisolatedCli);

const isolatedAdmission = {
  knowledgeCycleAdmission: {
    directory: mkdtempSync(resolve(tmpdir(), "lervo-upgrade-follower-admission-")),
  },
};

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function io(root: string, stdout: string[], stderr: string[]) {
  return {
    cwd: root,
    stdout: (message: string) => stdout.push(message),
    stderr: (message: string) => stderr.push(message),
  };
}

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-upgrade-follower-"));
  roots.push(root);
  await writeFile(resolve(root, "main.ts"), "export const value = true;\n");
  expect(await runCli(["init", "--minimal", "--name", "follower-fixture"], io(root, [], []))).toBe(
    0,
  );
  return root;
}

/**
 * ADR-0591: the follower that installs a release still runs the previous release's package, so
 * every argument vector that package sends must get one JSON result from the new CLI. These are
 * the v0.26.0 follower's vectors (`host-repository-pass.ts`), copied literally.
 */
const previousFollowerVectors = (root: string, planId: string) => ({
  plan: ["upgrade", "--root", root, "--json"],
  apply: ["upgrade", "--root", root, "--apply", "--approval", planId, "--json"],
  safeApply: ["upgrade", "--root", root, "--apply", "--safe", "--json"],
});

describe("lervo upgrade and the previous release's follower", () => {
  it("answers every v0.26.0 follower vector with a JSON result", async () => {
    const root = await repository();
    const planOutput: string[] = [];
    const errors: string[] = [];
    expect(
      await runCli(["upgrade", "--root", root, "--json"], io(root, planOutput, errors)),
      errors.join("\n"),
    ).toBe(0);
    const plan = JSON.parse(planOutput.join("")) as { planId: string; status: string };
    expect(plan.status).toBe("ready");
    const vectors = previousFollowerVectors(root, plan.planId);

    for (const [name, args] of Object.entries(vectors)) {
      const output: string[] = [];
      await runCli(args, io(root, output, errors), isolatedAdmission);
      const parsed = parseRepositoryUpgradeOutput(output.join(""));
      expect(parsed.kind, `${name}: ${output.join("")} ${errors.join("")}`).toBe("result");
    }
  }, 60_000);

  it("keeps --approval removed without --apply, and answers JSON callers with JSON", async () => {
    const root = await repository();
    const output: string[] = [];
    const errors: string[] = [];
    expect(
      await runCli(["upgrade", "--approval", "upg_previous", "--json"], io(root, output, errors)),
    ).toBe(1);
    expect(JSON.parse(output.join(""))).toMatchObject({
      status: "failed",
      error: { code: "upgrade_option_removed" },
    });
    expect(parseRepositoryUpgradeOutput(output.join(""))).toMatchObject({
      kind: "failed",
      code: "upgrade_option_removed",
    });

    output.length = 0;
    expect(await runCli(["upgrade", "--unknown", "--json"], io(root, output, errors))).toBe(1);
    expect(JSON.parse(output.join(""))).toMatchObject({
      status: "failed",
      error: { code: "upgrade_arguments_invalid" },
    });
  });
});
