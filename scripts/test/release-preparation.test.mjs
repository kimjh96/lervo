import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyReleasePreparation,
  createReleasePreparationPlan,
  nextCliVersion,
} from "../lib/release-preparation.mjs";
import { releaseDigest } from "../lib/release-intent.mjs";

const roots = [];
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

  it("replaces one bounded current release note without creating release history files", async () => {
    const root = await fixture([
      { impact: "patch", summary: "Correct deterministic current release notes." },
    ]);
    await writeFile(
      resolve(root, ".changes/current-release.md"),
      '<!-- lervo-release package="@lervo/cli" version="0.1.0" schema="1" -->\n\n## What\'s changed\n\n- Previous release.\n',
    );
    const input = { repositoryRoot: root, sourceRevision: "e".repeat(40) };
    const first = await createReleasePreparationPlan(input);
    const second = await createReleasePreparationPlan(input);
    expect(second.planId).toBe(first.planId);
    const noteOperation = first.operations.find(
      (operation) => operation.path === ".changes/current-release.md",
    );
    expect(noteOperation).toMatchObject({ action: "update" });
    expect(noteOperation.content).toContain('version="0.1.1"');
    expect(
      first.operations.some((operation) => operation.path.startsWith(".changes/releases/")),
    ).toBe(false);
  });

  it("runs owned generators, consumes intent, and rolls back on generator failure", async () => {
    const root = await fixture([
      { impact: "patch", summary: "Correct exact release preparation behavior for CLI users." },
    ]);
    const plan = await createReleasePreparationPlan({
      repositoryRoot: root,
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
    expect(await readdir(resolve(root, ".changes"))).toEqual(["current-release.md"]);

    const rollbackRoot = await fixture([
      { impact: "minor", summary: "Add a reviewed release workflow for public CLI users." },
    ]);
    const rollbackPlan = await createReleasePreparationPlan({
      repositoryRoot: rollbackRoot,
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
      sourceRevision: "d".repeat(40),
    });
    await writeFile(resolve(root, plan.operations.at(-1).path), "changed\n");
    await expect(
      applyReleasePreparation({ plan, approval: plan.planId, runOwned: () => undefined }),
    ).rejects.toThrowError(expect.objectContaining({ code: "release_intent_invalid" }));
  });
});
