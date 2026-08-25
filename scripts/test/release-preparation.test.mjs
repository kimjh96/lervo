import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyReleasePreparation,
  createReleasePreparationPlan,
  nextCliVersion,
} from "../lib/release-preparation.mjs";
import { releaseDigest } from "../lib/release-intent.mjs";

const roots = [];
const execFile = promisify(execFileCallback);
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function fixture(intents) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-release-preparation-"));
  roots.push(root);
  await mkdir(resolve(root, "apps/cli"), { recursive: true });
  await mkdir(resolve(root, ".changes"), { recursive: true });
  await writeFile(
    resolve(root, "apps/cli/package.json"),
    `${JSON.stringify({ name: "@lervo/cli", version: "0.1.0", private: false }, null, 2)}\n`,
  );
  await writeFile(
    resolve(root, "apps/cli/release-artifact-manifest.json"),
    `${JSON.stringify({ artifact: { version: "0.1.0" } }, null, 2)}\n`,
  );
  await writeFile(
    resolve(root, "apps/cli/release-sbom.cdx.json"),
    `${JSON.stringify({ metadata: { component: { version: "0.1.0" } } }, null, 2)}\n`,
  );
  await writeFile(resolve(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  for (const intent of intents) {
    const id = `relint_${releaseDigest({
      package: "@lervo/cli",
      impact: intent.impact,
      summary: intent.summary,
    }).slice("sha256:".length, "sha256:".length + 24)}`;
    await writeFile(
      resolve(root, `.changes/${id}.yaml`),
      `schemaVersion: 1\nintentId: ${id}\npackage: "@lervo/cli"\nimpact: ${intent.impact}\nsummary: ${intent.summary}\n`,
    );
  }
  return root;
}

describe("CLI release preparation", () => {
  it("applies the documented pre-1.0 compatibility policy", () => {
    expect(nextCliVersion("0.1.0", "patch")).toBe("0.1.1");
    expect(nextCliVersion("0.1.0", "minor")).toBe("0.2.0");
    expect(nextCliVersion("0.1.0", "major")).toBe("0.2.0");
    expect(nextCliVersion("1.2.3", "major")).toBe("2.0.0");
  });

  it("aggregates exact intent deterministically and uses only the public CLI version", async () => {
    const root = await fixture([
      { impact: "patch", summary: "Correct bounded diagnostic output for release users." },
      {
        impact: "major",
        summary: "Change the public command contract with reviewed migration guidance.",
      },
    ]);
    const input = {
      repositoryRoot: root,
      releaseDate: "2026-08-26",
      sourceRevision: "a".repeat(40),
    };
    const first = await createReleasePreparationPlan(input);
    const second = await createReleasePreparationPlan(input);
    expect(second.planId).toBe(first.planId);
    expect(first).toMatchObject({ currentVersion: "0.1.0", nextVersion: "0.2.0", impact: "major" });
    expect(first.intentIds).toHaveLength(2);
    expect(first.authority).toMatchObject({ tag: false, npmPublication: false });

    const additional = {
      package: "@lervo/cli",
      impact: "minor",
      summary: "Add another reviewed CLI capability to the same release pull request.",
    };
    const additionalId = `relint_${releaseDigest(additional).slice(
      "sha256:".length,
      "sha256:".length + 24,
    )}`;
    await writeFile(
      resolve(root, `.changes/${additionalId}.yaml`),
      `schemaVersion: 1\nintentId: ${additionalId}\npackage: "${additional.package}"\nimpact: ${additional.impact}\nsummary: ${additional.summary}\n`,
    );
    const updated = await createReleasePreparationPlan(input);
    expect(updated.planId).not.toBe(first.planId);
    expect(updated.intentIds).toHaveLength(3);
    expect(updated.nextVersion).toBe("0.2.0");
  });

  it("derives a stable release date from the exact source revision", async () => {
    const root = await fixture([
      { impact: "patch", summary: "Correct deterministic release pull request dates." },
    ]);
    await execFile("git", ["init", "--initial-branch=main"], { cwd: root });
    await execFile("git", ["config", "user.name", "Lervo Test"], { cwd: root });
    await execFile("git", ["config", "user.email", "lervo-test@example.invalid"], { cwd: root });
    await execFile("git", ["add", "."], { cwd: root });
    await execFile("git", ["commit", "-m", "test: add release fixture"], {
      cwd: root,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2026-07-04T12:00:00Z",
        GIT_COMMITTER_DATE: "2026-07-04T12:00:00Z",
      },
    });
    const first = await createReleasePreparationPlan({ repositoryRoot: root });
    const second = await createReleasePreparationPlan({ repositoryRoot: root });
    expect(second.planId).toBe(first.planId);
    expect(first.releaseDate).toBe("2026-07-04");
  });

  it("runs owned generators, consumes intent, and rolls back on generator failure", async () => {
    const root = await fixture([
      { impact: "patch", summary: "Correct exact release preparation behavior for CLI users." },
    ]);
    const plan = await createReleasePreparationPlan({
      repositoryRoot: root,
      releaseDate: "2026-08-26",
      sourceRevision: "b".repeat(40),
    });
    const commands = [];
    const receipt = await applyReleasePreparation({
      plan,
      approval: plan.planId,
      runOwned: async (command, args) => {
        commands.push([command, ...args].join(" "));
        if (args[0] === "release:manifest:update")
          await writeFile(
            resolve(root, "apps/cli/release-artifact-manifest.json"),
            `${JSON.stringify({ artifact: { version: "0.1.1" } }, null, 2)}\n`,
          );
        if (args[0] === "release:sbom:update")
          await writeFile(
            resolve(root, "apps/cli/release-sbom.cdx.json"),
            `${JSON.stringify({ metadata: { component: { version: "0.1.1" } } }, null, 2)}\n`,
          );
      },
    });
    expect(receipt).toMatchObject({ version: "0.1.1", authority: { npmPublication: false } });
    expect(commands).toEqual([
      "pnpm install --lockfile-only --frozen-lockfile",
      "pnpm build",
      "pnpm release:manifest:update",
      "pnpm release:sbom:update",
    ]);
    await expect(readFile(resolve(root, plan.operations.at(-1).path), "utf8")).rejects.toThrow();

    const rollbackRoot = await fixture([
      { impact: "minor", summary: "Add a reviewed release workflow for public CLI users." },
    ]);
    const rollbackPlan = await createReleasePreparationPlan({
      repositoryRoot: rollbackRoot,
      releaseDate: "2026-08-26",
      sourceRevision: "c".repeat(40),
    });
    await expect(
      applyReleasePreparation({
        plan: rollbackPlan,
        approval: rollbackPlan.planId,
        runOwned: () => {
          throw new Error("generator failed");
        },
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "release_preparation_failed" }));
    expect(
      JSON.parse(await readFile(resolve(rollbackRoot, "apps/cli/package.json"), "utf8")).version,
    ).toBe("0.1.0");
    expect(
      await readFile(resolve(rollbackRoot, rollbackPlan.operations.at(-1).path), "utf8"),
    ).toContain("impact: minor");
  });

  it("rejects a stale plan without partial apply", async () => {
    const root = await fixture([
      { impact: "patch", summary: "Correct stale release-plan handling for CLI users." },
    ]);
    const plan = await createReleasePreparationPlan({
      repositoryRoot: root,
      releaseDate: "2026-08-26",
      sourceRevision: "d".repeat(40),
    });
    await writeFile(resolve(root, plan.operations.at(-1).path), "changed\n");
    await expect(
      applyReleasePreparation({ plan, approval: plan.planId, runOwned: () => undefined }),
    ).rejects.toThrowError(expect.objectContaining({ code: "release_intent_invalid" }));
  });
});
