import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { classifyCiChanges } from "../lib/ci-change-classification.mjs";
import { aggregateCiVerification } from "../lib/ci-verification-result.mjs";
import { createCiVerificationPlan } from "../lib/ci-verification-plan.mjs";

const roots = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("CI admission", () => {
  it("admits only explicit documentation paths and forces full manual verification", () => {
    expect(classifyCiChanges(["docs/architecture/system.md"]).coverage).toBe("documentation_only");
    expect(classifyCiChanges(["docs/architecture/system.md"], true).coverage).toBe("full");
    for (const path of [
      "README.md",
      "apps/cli/README.md",
      "docs/fixtures/input.md",
      "docs/../package.json",
      "docs/specs/data.json",
      "pnpm-lock.yaml",
      ".github/workflows/check.yml",
      "apps/cli/src/main.ts",
    ])
      expect(classifyCiChanges(["docs/a.md", path]).coverage).toBe("full");
    for (const unknown of [null, [], Array(20_001).fill("docs/a.md")])
      expect(classifyCiChanges(unknown).coverage).toBe("full");
  });

  it("observes both sides of renames and refuses moved dispatch revisions", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-ci-plan-"));
    roots.push(root);
    const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    git("init", "--quiet");
    git("config", "user.name", "CI Fixture");
    git("config", "user.email", "ci@lervo.invalid");
    await writeFile(resolve(root, "runtime.md"), "runtime input\n");
    git("add", ".");
    git("commit", "--quiet", "-m", "fixture: initial");
    const base = git("rev-parse", "HEAD");
    expect(
      createCiVerificationPlan({
        repositoryRoot: root,
        event: { eventName: "workflow_dispatch" },
      }),
    ).toMatchObject({ coverage: "full", baseRevision: "0".repeat(40) });
    expect(() =>
      createCiVerificationPlan({
        repositoryRoot: root,
        event: { eventName: "workflow_dispatch", inputs: { base_sha: base } },
      }),
    ).toThrow("ci_base_revision_invalid");
    await mkdir(resolve(root, "docs"));
    git("mv", "runtime.md", "docs/runtime.md");
    git("commit", "--quiet", "-m", "docs: move");
    const plan = createCiVerificationPlan({
      repositoryRoot: root,
      event: { eventName: "push", before: base },
    });
    expect(plan.coverage).toBe("full");
    expect(plan.changedPathCount).toBe(2);
    expect(() =>
      createCiVerificationPlan({
        repositoryRoot: root,
        event: { eventName: "workflow_dispatch" },
        expectedRevision: base,
      }),
    ).toThrow("ci_revision_mismatch");
    const missing = "a".repeat(40);
    expect(
      createCiVerificationPlan({
        repositoryRoot: root,
        event: { eventName: "push", before: missing },
      }),
    ).toMatchObject({ coverage: "full", baseRevision: missing });
    expect(() =>
      createCiVerificationPlan({
        repositoryRoot: root,
        event: {
          eventName: "workflow_dispatch",
          inputs: { base_sha: `${base}\ncoverage=documentation_only` },
        },
      }),
    ).toThrow("ci_base_revision_invalid");
  });
});

describe("release metadata verification", () => {
  async function released() {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-ci-metadata-"));
    roots.push(root);
    const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    git("init", "--quiet");
    git("config", "user.name", "CI Fixture");
    git("config", "user.email", "ci@lervo.invalid");
    const commit = async (files) => {
      for (const [path, content] of Object.entries(files)) {
        await mkdir(resolve(root, path, ".."), { recursive: true });
        await writeFile(resolve(root, path), content);
      }
      git("add", "-A");
      git("commit", "--quiet", "-m", "fixture: change");
      return git("rev-parse", "HEAD");
    };
    const release = await commit({
      "apps/cli/package.json": '{"name":"@lervo/cli","version":"0.1.0"}\n',
      "apps/cli/src/main.ts": "export {};\n",
      "apps/cli/release-artifact-manifest.json": "{}\n",
      "apps/cli/release-sbom.cdx.json": "{}\n",
    });
    git("tag", "-a", "v0.1.0", "-m", "Release @lervo/cli v0.1.0");
    const plan = (event) =>
      createCiVerificationPlan({ repositoryRoot: root, event }).releaseMetadata;
    return { root, git, commit, release, plan };
  }

  it("generates the metadata for a change under an already released version", async () => {
    const f = await released();
    await f.commit({ "apps/cli/src/main.ts": "export const changed = true;\n" });
    expect(f.plan({ eventName: "pull_request", pull_request: { base: { sha: f.release } } })).toBe(
      "generated",
    );
    expect(f.plan({ eventName: "push", before: f.release })).toBe("generated");
    expect(f.plan({ eventName: "schedule" })).toBe("generated");
  });

  it("requires exact committed metadata for an unreleased version or an edit to the files", async () => {
    const f = await released();
    const edited = await f.commit({ "apps/cli/release-sbom.cdx.json": '{"edited":true}\n' });
    expect(f.plan({ eventName: "push", before: f.release })).toBe("exact");
    await f.commit({ "apps/cli/src/main.ts": "export const changed = true;\n" });
    expect(f.plan({ eventName: "push", before: edited })).toBe("generated");
    const prepared = await f.commit({
      "apps/cli/package.json": '{"name":"@lervo/cli","version":"0.1.1"}\n',
    });
    expect(f.plan({ eventName: "workflow_dispatch", inputs: { base_sha: f.release } })).toBe(
      "exact",
    );
    await f.commit({ "apps/cli/src/main.ts": "export const later = true;\n" });
    // Merged after a release but before its tag: the tag would name this tree.
    expect(f.plan({ eventName: "push", before: prepared })).toBe("exact");
    f.git("tag", "-a", "v0.1.1", "-m", "Release @lervo/cli v0.1.1");
    expect(f.plan({ eventName: "push", before: prepared })).toBe("generated");
  });

  it("selects exact verification whenever the change, version, or tag is unknown", async () => {
    const f = await released();
    await f.commit({ "apps/cli/src/main.ts": "export const changed = true;\n" });
    expect(f.plan({ eventName: "push", before: "a".repeat(40) })).toBe("exact");
    f.git("tag", "-d", "v0.1.0");
    f.git("tag", "v0.1.0");
    expect(f.plan({ eventName: "push", before: f.release })).toBe("generated");
    f.git("tag", "-d", "v0.1.0");
    expect(f.plan({ eventName: "push", before: f.release })).toBe("exact");
    await f.commit({ "apps/cli/package.json": '{"name":"@lervo/cli","version":"next"}\n' });
    f.git("tag", "vnext");
    expect(f.plan({ eventName: "push", before: f.release })).toBe("exact");
  });
});

describe("aggregate verification", () => {
  const complete = {
    coverage: "full",
    plan: "success",
    quality: "success",
    build: "success",
    tests: "success",
    distribution: "success",
    distributionRequired: true,
  };
  it("requires every required job and treats cancellation or unknown as failure", () => {
    expect(aggregateCiVerification(complete)).toBe("passed");
    for (const job of ["plan", "quality", "build", "tests", "distribution"])
      for (const result of ["failure", "cancelled", "skipped", "unknown"])
        expect(aggregateCiVerification({ ...complete, [job]: result })).toBe("failed");
    expect(aggregateCiVerification({ ...complete, coverage: undefined })).toBe("failed");
  });
  it("explicitly distinguishes a documentation-only pass from full coverage", () => {
    expect(
      aggregateCiVerification({
        ...complete,
        coverage: "documentation_only",
        build: "skipped",
        tests: "skipped",
        distribution: "skipped",
        distributionRequired: false,
      }),
    ).toBe("passed");
    expect(aggregateCiVerification({ ...complete, coverage: "documentation_only" })).toBe("failed");
  });
});
