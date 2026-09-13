import { afterEach, describe, expect, it } from "vitest";
import { access, rm, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { verificationSuiteHash } from "@lervo/verification";
import { projectOutcomeSupervision } from "@lervo/work-controller";
import { observeSupervisionVerificationReadiness } from "../src/supervision-verification-readiness.js";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { snapshotRuntimeReadinessConfiguration } from "../src/supervision-runtime-configuration.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const f = await dispatchFixture(roots);
  const plan = (await f.ports.propose(
    projectOutcomeSupervision({
      snapshot: f.observation,
      now: f.ports.now(),
      maximumRecoveryDecisions: 1,
    }),
  ))!;
  return {
    ...f,
    input: {
      repositoryRoot: f.root,
      configuration: f.runtimeReadiness,
      readiness: await f.ports.readWorkerReadiness(plan),
      now: f.ports.now,
    },
  };
}

describe("supervision verification definitions", { timeout: 30_000 }, () => {
  it("observes exact definitions without running commands or refreshing application evidence", async () => {
    const f = await fixture();
    const suite = f.suites[0]!;
    suite.commands[0]!.arguments = [
      "-e",
      "require('node:fs').writeFileSync('must-not-run', 'ran')",
    ];
    await writeFile(
      resolve(f.root, `.lervo/verifications/${suite.suiteId}.yaml`),
      JSON.stringify(suite),
    );
    f.runtimeReadiness.verificationSuiteHashes[suite.suiteId] = verificationSuiteHash(suite);
    const result = await observeSupervisionVerificationReadiness(f.input);
    const check = result.observation.checks.find((item) => item.kind === "verification")!;
    expect(check.status).toBe("passed");
    expect(check.evidenceHash).not.toBe(
      f.input.readiness.observation.checks.find((item) => item.kind === "verification")!
        .evidenceHash,
    );
    expect(result.observation.observedAt).toBe(f.input.readiness.observation.observedAt);
    expect(JSON.stringify(result)).not.toContain("must-not-run");
    await expect(access(resolve(f.root, "must-not-run"))).rejects.toThrow();
  });

  it.each(["pin", "missing", "changed", "invalid", "symlink", "cwd", "time"])(
    "rejects %s definitions",
    async (change) => {
      const f = await fixture();
      const suite = f.suites[0]!;
      const path = resolve(f.root, `.lervo/verifications/${suite.suiteId}.yaml`);
      if (change === "pin") f.runtimeReadiness.verificationSuiteHashes = {};
      if (change === "missing") await rm(path);
      if (change === "invalid") await writeFile(path, "invalid: true\n");
      if (change === "changed") {
        suite.commands[0]!.arguments = ["--help"];
        await writeFile(path, JSON.stringify(suite));
      }
      if (change === "symlink") {
        const outside = resolve(f.root, "suite.yaml");
        await writeFile(outside, JSON.stringify(suite));
        await rm(path);
        await symlink(outside, path);
      }
      if (change === "cwd") {
        suite.commands[0]!.cwd = "absent";
        await writeFile(path, JSON.stringify(suite));
        f.runtimeReadiness.verificationSuiteHashes[suite.suiteId] = verificationSuiteHash(suite);
      }
      if (change === "time") {
        let count = 0;
        const time = Date.parse(f.ports.now());
        f.input.now = () => new Date(time + (count++ === 0 ? 0 : 5001)).toISOString();
      }
      expect(
        (await observeSupervisionVerificationReadiness(f.input)).observation.checks.find(
          (item) => item.kind === "verification",
        ),
      ).toMatchObject({ status: "unobserved", evidenceHash: null });
    },
  );

  it.each(["failed", "unobserved", "not_required"] as const)(
    "preserves %s application verification evidence",
    async (status) => {
      const f = await fixture();
      f.input.readiness.observation.checks.find((item) => item.kind === "verification")!.status =
        status;
      expect(await observeSupervisionVerificationReadiness(f.input)).toEqual(f.input.readiness);
    },
  );

  it("rejects definition replacement after the first execution preflight", async () => {
    const f = await dispatchFixture(roots);
    const read = f.ports.readWorkerReadiness;
    let count = 0;
    f.ports.readWorkerReadiness = async (plan) => {
      if (++count === 2) {
        const suite = f.suites[0]!;
        suite.commands[0]!.arguments = ["--help"];
        await writeFile(
          resolve(f.root, `.lervo/verifications/${suite.suiteId}.yaml`),
          JSON.stringify(suite),
        );
      }
      return read(plan);
    };
    const runtime = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: f.ports,
      runtimeReadiness: f.runtimeReadiness,
    });
    try {
      expect((await runtime.runCycle()).disposition).toBe("uncertain");
      expect(f.counts().effects).toBe(0);
      expect(count).toBe(2);
    } finally {
      await runtime.close();
    }
  });

  it("rejects malformed hash pins before storage opens", () => {
    expect(() =>
      snapshotRuntimeReadinessConfiguration({
        providerExecutables: {},
        verificationTools: {},
        verificationSuiteHashes: { "save.restart": "unreviewed" },
      }),
    ).toThrow(TypeError);
  });
});
