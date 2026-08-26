import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { applyReleaseTag, createReleaseTagPlan, ReleaseTagError } from "../lib/release-tag.mjs";

const execFile = promisify(execFileCallback);
const roots = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function git(root, ...args) {
  return execFile("git", args, { cwd: root });
}

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-release-tag-"));
  roots.push(root);
  await mkdir(resolve(root, "apps/cli"), { recursive: true });
  await mkdir(resolve(root, ".changes"), { recursive: true });
  await writeFile(
    resolve(root, "apps/cli/package.json"),
    `${JSON.stringify({ name: "@lervo/cli", version: "0.2.0", private: false }, null, 2)}\n`,
  );
  await writeFile(
    resolve(root, ".changes/current-release.md"),
    '<!-- lervo-release package="@lervo/cli" version="0.2.0" schema="1" -->\n\n## What\'s changed\n\n- Release.\n',
  );
  await writeFile(
    resolve(root, "apps/cli/release-artifact-manifest.json"),
    `${JSON.stringify({ artifact: { version: "0.2.0" } }, null, 2)}\n`,
  );
  await writeFile(
    resolve(root, "apps/cli/release-sbom.cdx.json"),
    `${JSON.stringify({ metadata: { component: { version: "0.2.0" } } }, null, 2)}\n`,
  );
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.name", "Lervo Test");
  await git(root, "config", "user.email", "lervo@example.invalid");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "chore(cli): prepare release");
  return root;
}

describe("exact CLI release tag", () => {
  it("creates one annotated tag and converges on replay", async () => {
    const root = await fixture();
    const plan = await createReleaseTagPlan({ repositoryRoot: root });
    expect(plan).toMatchObject({ status: "ready", tag: "v0.2.0" });
    const receipt = await applyReleaseTag({ plan, approval: plan.planId });
    expect(receipt).toMatchObject({ disposition: "created", publication: "not_authorized" });
    const replay = await createReleaseTagPlan({ repositoryRoot: root });
    expect(replay.status).toBe("current");
    const type = await git(root, "cat-file", "-t", "refs/tags/v0.2.0");
    expect(type.stdout.trim()).toBe("tag");
  });

  it("blocks dirty main and a conflicting same-version tag", async () => {
    const root = await fixture();
    await writeFile(resolve(root, "dirty.txt"), "dirty\n");
    expect((await createReleaseTagPlan({ repositoryRoot: root })).blockers).toContain(
      "working_tree_not_clean",
    );
    await rm(resolve(root, "dirty.txt"));
    await git(root, "tag", "v0.2.0");
    const conflict = await createReleaseTagPlan({ repositoryRoot: root });
    expect(conflict).toMatchObject({ status: "blocked" });
    expect(conflict.blockers).toContain("release_tag_conflict");
  });

  it("rejects stale plans and version-bound metadata mismatches", async () => {
    const root = await fixture();
    const plan = await createReleaseTagPlan({ repositoryRoot: root });
    await writeFile(
      resolve(root, "apps/cli/release-artifact-manifest.json"),
      `${JSON.stringify({ artifact: { version: "0.1.9" } }, null, 2)}\n`,
    );
    expect((await createReleaseTagPlan({ repositoryRoot: root })).blockers).toContain(
      "release_manifest_version_mismatch",
    );
    await writeFile(
      resolve(root, ".changes/current-release.md"),
      '<!-- lervo-release package="@lervo/cli" version="0.1.9" schema="1" -->\n\n## What\'s changed\n\n- Stale.\n',
    );
    expect((await createReleaseTagPlan({ repositoryRoot: root })).blockers).toContain(
      "release_notes_version_missing",
    );
    await git(root, "add", ".");
    await git(root, "commit", "-m", "test: change release metadata");
    await expect(applyReleaseTag({ plan, approval: plan.planId })).rejects.toThrowError(
      expect.objectContaining({ code: "release_tag_plan_stale" }),
    );
  });

  it("recovers an exact tag after an uncertain creation result and fails without one", async () => {
    const recoveredRoot = await fixture();
    const recoveredPlan = await createReleaseTagPlan({ repositoryRoot: recoveredRoot });
    const recovered = await applyReleaseTag({
      plan: recoveredPlan,
      approval: recoveredPlan.planId,
      createTag: async ({ tag, message, sourceRevision }) => {
        await git(recoveredRoot, "tag", "-a", tag, "-m", message, sourceRevision);
        throw new Error("result lost after tag creation");
      },
    });
    expect(recovered.disposition).toBe("created");

    const failedRoot = await fixture();
    const failedPlan = await createReleaseTagPlan({ repositoryRoot: failedRoot });
    await expect(
      applyReleaseTag({
        plan: failedPlan,
        approval: failedPlan.planId,
        createTag: () => {
          throw new Error("tag not created");
        },
      }),
    ).rejects.toBeInstanceOf(ReleaseTagError);
    expect((await createReleaseTagPlan({ repositoryRoot: failedRoot })).status).toBe("ready");
  });
});
