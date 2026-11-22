import { mkdtempSync } from "node:fs";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { holdEffect, readHeldEffects } from "../src/held-effect-debt.js";
import { runCli as runUnisolatedCli } from "../src/main.js";
import { knowledgeStageWaitReason } from "../src/upgrade-knowledge-gate.js";
import { commitRepository } from "./committed-repository.js";
import { withIsolatedUpgradeHost } from "./upgrade-host-isolation.js";

const runCli = withIsolatedUpgradeHost(runUnisolatedCli);
const execute = promisify(execFile);
const isolatedAdmission = {
  knowledgeCycleAdmission: {
    directory: mkdtempSync(resolve(tmpdir(), "lervo-upgrade-owner-gate-admission-")),
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

/** A committed repository on `main` whose first knowledge stage is ready. */
async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-upgrade-owner-gate-"));
  roots.push(root);
  await writeFile(resolve(root, "main.ts"), "export const value = true;\n");
  expect(await runCli(["init", "--minimal", "--name", "owner-gate"], io(root, [], []))).toBe(0);
  commitRepository(root);
  return root;
}

/** This host is configured for Hub coordination and another host owns convergence (ADR-0597). */
async function ownedElsewhere(root: string): Promise<void> {
  await mkdir(resolve(root, ".lervo/state/knowledge"), { recursive: true });
  await writeFile(
    resolve(root, ".lervo/state/knowledge/convergence-owner-host.json"),
    JSON.stringify({
      schemaVersion: 1,
      hostId: `hst_${"a".repeat(32)}`,
      hostLabel: "mac",
      coordination: {
        mode: "hub",
        hub: {
          baseUrl: "https://hub.lervo.invalid",
          bearerTokenFile: "/nonexistent/lervo-hub-token",
          destinationId: "hub-main",
          hubIdentityHash: `sha256:${"9".repeat(64)}`,
        },
      },
    }),
  );
  await writeFile(
    resolve(root, ".lervo/state/knowledge/convergence-owner.json"),
    JSON.stringify({
      schemaVersion: 1,
      recordedHolderKey: null,
      verdict: {
        role: "waiting_owner",
        reason: "convergence_owner_elsewhere",
        mode: "hub",
        hostHash: `sha256:${"1".repeat(64)}`,
        hostLabel: "mac",
        holder: {
          hostHash: `sha256:${"2".repeat(64)}`,
          label: "wsl",
          generation: 3,
          expiresAt: null,
        },
        validUntil: null,
        wakeAt: null,
        grantedAt: null,
        yieldUntil: null,
        observedAt: new Date().toISOString(),
      },
    }),
  );
}

interface Plan {
  status: string;
  applicableStages: string[];
  stages: { knowledge: { disposition: string; reason: string } };
}

async function apply(root: string): Promise<{
  skippedStages: Array<{ stage: string; reason: string }>;
}> {
  const output: string[] = [];
  const errors: string[] = [];
  await runCli(["upgrade", "--apply", "--json"], io(root, output, errors), isolatedAdmission);
  return JSON.parse(output.join("")) as { skippedStages: Array<{ stage: string; reason: string }> };
}

async function plan(root: string): Promise<Plan> {
  const output: string[] = [];
  const errors: string[] = [];
  expect(await runCli(["upgrade", "--json"], io(root, output, errors)), errors.join("")).toBe(0);
  return JSON.parse(output.join("")) as Plan;
}

describe("upgrade knowledge stages on a host that does not own convergence (ADR-0610)", () => {
  it("plans them as Lervo debt with the reason its apply skips them for", async () => {
    const root = await repository();
    expect((await plan(root)).stages.knowledge.disposition).toBe("safe_apply");

    await ownedElsewhere(root);
    const waiting = await plan(root);
    expect(waiting.stages.knowledge).toMatchObject({
      disposition: "lervo_debt",
      reason: "convergence_owner_elsewhere",
    });
    expect(waiting.applicableStages).not.toContain("knowledge");

    // An earlier release held the plan because no commit was possible; that record is the same
    // wait the plan now carries, so the skip releases it. A cross-check disagreement stays.
    await holdEffect({
      repositoryRoot: root,
      effect: "upgrade_knowledge",
      subject: "kmp_earlier",
      reasonCode: "commit_unavailable",
    });
    await holdEffect({
      repositoryRoot: root,
      effect: "upgrade_knowledge",
      subject: "kmp_disagreed",
      reasonCode: "cross_check_disagreement_repeated",
    });
    const head = (await execute("git", ["-C", root, "rev-parse", "HEAD"])).stdout;
    const receipt = await apply(root);
    expect((await readHeldEffects(root)).map((item) => item.subject)).toEqual(["kmp_disagreed"]);
    expect(receipt.skippedStages).toContainEqual({
      stage: "knowledge",
      reason: "convergence_owner_elsewhere",
    });
    // The owning host writes the knowledge outputs; this host committed and wrote none.
    expect((await execute("git", ["-C", root, "rev-parse", "HEAD"])).stdout).toBe(head);
    await expect(access(resolve(root, "docs/knowledge/index.md"))).rejects.toThrow();
    // Converged, apart from what waits for the owner, so a follower reports Lervo debt.
    expect((await plan(root)).status).toBe("lervo_debt");
  }, 30_000);

  it("leaves a stage held for another reason to the existing path, with no gate skip", async () => {
    const root = await repository();
    await apply(root);
    // No provider can cross-check the next reviewed plan here, so it is held for that reason.
    expect((await plan(root)).stages.knowledge).toMatchObject({
      disposition: "lervo_debt",
      reason: "cross_check_unavailable",
    });
    await ownedElsewhere(root);
    expect((await plan(root)).stages.knowledge.reason).toBe("cross_check_unavailable");
    const receipt = await apply(root);
    expect(receipt.skippedStages).not.toContainEqual({
      stage: "knowledge",
      reason: "convergence_owner_elsewhere",
    });
  }, 30_000);

  it("waits a reviewed plan outside Git, where it has no commit, and applies a generated one", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-upgrade-owner-gate-plain-"));
    roots.push(root);
    await expect(knowledgeStageWaitReason(root, { status: "review_required" })).resolves.toBe(
      "repository_not_committable",
    );
    await expect(knowledgeStageWaitReason(root, { status: "ready" })).resolves.toBeNull();
  });

  it("plans them as Lervo debt off the base branch", async () => {
    const root = await repository();
    await execute("git", ["-C", root, "checkout", "-q", "-b", "feature"]);
    expect((await plan(root)).stages.knowledge).toMatchObject({
      disposition: "lervo_debt",
      reason: "not_on_base",
    });
  }, 30_000);
});
