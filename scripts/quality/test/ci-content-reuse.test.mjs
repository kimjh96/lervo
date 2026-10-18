import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { computeCiContentDigests } from "../lib/ci-content-digest.mjs";
import { findReusableRun, planCiReuse } from "../lib/ci-reuse-receipts.mjs";

const roots = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function repository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-ci-reuse-"));
  roots.push(root);
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "--quiet");
  git("config", "user.name", "CI Fixture");
  git("config", "user.email", "ci@example.invalid");
  await mkdir(resolve(root, "apps/cli/src"), { recursive: true });
  await mkdir(resolve(root, ".changes"), { recursive: true });
  const write = (path, content) => writeFile(resolve(root, path), content);
  const commit = async (files) => {
    for (const [path, content] of Object.entries(files)) await write(path, content);
    git("add", "-A");
    git("commit", "--quiet", "-m", "fixture");
    return git("rev-parse", "HEAD");
  };
  return { root, commit };
}

const manifest = (version, extra = {}) =>
  `${JSON.stringify({ name: "@lervo/cli", version, ...extra }, null, 2)}\n`;

describe("CI content digests", () => {
  it("keeps the test digest across release preparation and changes it for source", async () => {
    const { root, commit } = await repository();
    const source = await commit({
      "apps/cli/src/main.ts": "export {};\n",
      "apps/cli/package.json": manifest("0.1.0"),
      "apps/cli/release-artifact-manifest.json": '{"version":"0.1.0"}\n',
      "apps/cli/release-sbom.cdx.json": '{"version":"0.1.0"}\n',
      ".changes/relint_a.yaml": "impact: patch\n",
    });
    const candidate = await commit({
      "apps/cli/package.json": manifest("0.1.1"),
      "apps/cli/release-artifact-manifest.json": '{"version":"0.1.1"}\n',
      "apps/cli/release-sbom.cdx.json": '{"version":"0.1.1"}\n',
      ".changes/current-release.md": "## What's changed\n",
    });
    const before = computeCiContentDigests({ repositoryRoot: root, revision: source });
    const after = computeCiContentDigests({ repositoryRoot: root, revision: candidate });
    expect(after.tree).not.toBe(before.tree);
    expect(after.tests).toBe(before.tests);

    const dependency = await commit({
      "apps/cli/package.json": manifest("0.1.1", { dependencies: { zod: "4.4.3" } }),
    });
    expect(computeCiContentDigests({ repositoryRoot: root, revision: dependency }).tests).not.toBe(
      after.tests,
    );
    const code = await commit({ "apps/cli/src/main.ts": "export const changed = true;\n" });
    expect(computeCiContentDigests({ repositoryRoot: root, revision: code }).tests).not.toBe(
      after.tests,
    );
  });
});

const repositoryName = "owner/lervo";
const digest = "a".repeat(40);
const successfulRun = {
  id: 7,
  path: ".github/workflows/code-quality.yml",
  status: "completed",
  conclusion: "success",
  repository: { full_name: repositoryName },
  head_repository: { full_name: repositoryName },
};
const testJobs = [1, 2, 3, 4].map((shard) => ({
  name: `Tests (shard ${shard}/4)`,
  conclusion: "success",
}));

function api({ artifacts, run = successfulRun, jobs = testJobs }) {
  return (path) => {
    if (path.includes("/actions/artifacts?")) return { artifacts };
    if (path.endsWith("/jobs?filter=latest&per_page=100")) return { jobs };
    if (path.includes("/actions/runs/")) return run;
    throw new Error(`unexpected ${path}`);
  };
}
const artifact = (overrides = {}) => ({
  name: `lervo-ci-tests-${digest}`,
  expired: false,
  workflow_run: { id: 7 },
  ...overrides,
});
const find = (request) =>
  findReusableRun({ repository: repositoryName, component: "tests", digest, request });

describe("CI reuse receipts", () => {
  it("reuses only a completed successful same-repository run whose own jobs passed", () => {
    expect(find(api({ artifacts: [artifact()] }))).toBe(7);
    for (const rejected of [
      api({ artifacts: [artifact({ expired: true })] }),
      api({ artifacts: [artifact({ name: `lervo-ci-tests-${"b".repeat(40)}` })] }),
      api({ artifacts: [artifact()], run: { ...successfulRun, conclusion: "failure" } }),
      api({ artifacts: [artifact()], run: { ...successfulRun, status: "in_progress" } }),
      api({
        artifacts: [artifact()],
        run: { ...successfulRun, path: ".github/workflows/other.yml" },
      }),
      api({
        artifacts: [artifact()],
        run: { ...successfulRun, head_repository: { full_name: "fork/lervo" } },
      }),
      api({ artifacts: [artifact()], jobs: testJobs.slice(1) }),
      api({
        artifacts: [artifact()],
        jobs: [...testJobs.slice(1), { name: "Tests (shard 1/4)", conclusion: "skipped" }],
      }),
      () => {
        throw new Error("api unavailable");
      },
    ])
      expect(find(rejected)).toBeNull();
    expect(
      findReusableRun({
        repository: repositoryName,
        component: "tests",
        digest: "../x",
        request: api({ artifacts: [artifact()] }),
      }),
    ).toBeNull();
  });

  it("reuses build and quality only with tests and any required distribution", () => {
    const digests = { tree: "t".repeat(40), tests: "s".repeat(40) };
    const available = (components) => (component) => (components.includes(component) ? 9 : null);
    expect(
      planCiReuse({
        coverage: "documentation_only",
        distributionRequired: false,
        digests,
        find: available(["build", "tests"]),
      }),
    ).toEqual({ quality: false, build: null, tests: null, distribution: null });
    expect(
      planCiReuse({
        coverage: "full",
        distributionRequired: false,
        digests,
        find: available(["build"]),
      }),
    ).toEqual({ quality: false, build: null, tests: null, distribution: null });
    expect(
      planCiReuse({
        coverage: "full",
        distributionRequired: false,
        digests,
        find: available(["tests"]),
      }),
    ).toEqual({ quality: false, build: null, tests: 9, distribution: null });
    expect(
      planCiReuse({
        coverage: "full",
        distributionRequired: true,
        digests,
        find: available(["build", "tests"]),
      }),
    ).toEqual({ quality: false, build: null, tests: 9, distribution: null });
    expect(
      planCiReuse({
        coverage: "full",
        distributionRequired: true,
        digests,
        find: available(["build", "tests", "distribution"]),
      }),
    ).toEqual({ quality: true, build: 9, tests: 9, distribution: 9 });
  });
});
