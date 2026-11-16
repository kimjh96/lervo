import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  findVerifiedReleaseRun,
  planReleaseMatrix,
  releaseSubjectsArtifactName,
  verifiedReleaseJobs,
} from "../lib/cli-release-matrix-reuse.mjs";

const repository = "owner/lervo";
const tree = "a".repeat(40);
const head = "b".repeat(40);

function api({ artifact = {}, run = {}, commitTree = tree, jobs = verifiedReleaseJobs } = {}) {
  const calls = [];
  const request = (path) => {
    calls.push(path);
    if (path.startsWith(`repos/${repository}/actions/artifacts?`))
      return {
        artifacts: [
          {
            name: releaseSubjectsArtifactName(tree),
            expired: false,
            workflow_run: { id: 41 },
            ...artifact,
          },
        ],
      };
    if (path === `repos/${repository}/actions/runs/41`)
      return {
        path: ".github/workflows/cli-release-matrix.yml",
        status: "completed",
        conclusion: "success",
        repository: { full_name: repository },
        head_repository: { full_name: repository },
        head_sha: head,
        ...run,
      };
    if (path === `repos/${repository}/git/commits/${head}`) return { tree: { sha: commitTree } };
    if (path.startsWith(`repos/${repository}/actions/runs/41/jobs`))
      return { jobs: jobs.map((name) => ({ name, conclusion: "success" })) };
    throw new Error(`unexpected request ${path}`);
  };
  return { request, calls };
}

const find = (state) => findVerifiedReleaseRun({ repository, tree, request: api(state).request });

describe("CLI release matrix reuse", () => {
  it("finds a successful run that verified the exact tree on every platform", () => {
    const { request, calls } = api();
    assert.equal(findVerifiedReleaseRun({ repository, tree, request }), 41);
    assert.equal(
      calls[0],
      `repos/${repository}/actions/artifacts?name=lervo-cli-release-${tree}&per_page=20`,
    );
    assert.deepEqual(verifiedReleaseJobs, [
      "Native runtime artifacts",
      "Packed CLI (ubuntu-latest)",
      "Packed CLI (macos-latest)",
      "Packed CLI (windows-latest)",
    ]);
  });

  it("never reuses unverified, foreign, expired, or mismatched runs", () => {
    for (const state of [
      { artifact: { expired: true } },
      { artifact: { name: "lervo-cli-release-other" } },
      { artifact: { workflow_run: {} } },
      { run: { conclusion: "failure" } },
      { run: { status: "in_progress" } },
      { run: { path: ".github/workflows/code-quality.yml" } },
      { run: { head_repository: { full_name: "fork/lervo" } } },
      { commitTree: "c".repeat(40) },
      { jobs: verifiedReleaseJobs.slice(1) },
    ])
      assert.equal(find(state), null, JSON.stringify(state));
    const failing = () => {
      throw new Error("API unavailable");
    };
    assert.equal(findVerifiedReleaseRun({ repository, tree, request: failing }), null);
    assert.equal(findVerifiedReleaseRun({ repository: "bad", tree, request: api().request }), null);
    assert.equal(
      findVerifiedReleaseRun({ repository, tree: "HEAD", request: api().request }),
      null,
    );
  });

  it("reuses only on a tag where the attestation job would be skipped", () => {
    const base = { expectedRevision: "", revision: head, tree, find: () => 41 };
    assert.deepEqual(planReleaseMatrix({ ...base, refType: "tag", attestationApplicable: false }), {
      tree,
      reuse: "41",
    });
    for (const state of [
      { refType: "branch", attestationApplicable: false },
      { refType: "tag", attestationApplicable: true },
    ])
      assert.deepEqual(planReleaseMatrix({ ...base, ...state }), { tree, reuse: "" });
    assert.deepEqual(
      planReleaseMatrix({
        ...base,
        refType: "tag",
        attestationApplicable: false,
        find: () => null,
      }),
      { tree, reuse: "" },
    );
  });

  it("rejects a dispatch whose branch moved away from the expected revision", () => {
    const base = { refType: "branch", attestationApplicable: false, tree, find: () => null };
    assert.deepEqual(planReleaseMatrix({ ...base, expectedRevision: head, revision: head }), {
      tree,
      reuse: "",
    });
    assert.throws(
      () => planReleaseMatrix({ ...base, expectedRevision: head, revision: "c".repeat(40) }),
      (error) => error.code === "release_matrix_revision_moved",
    );
    assert.throws(
      () => planReleaseMatrix({ ...base, expectedRevision: "main", revision: head }),
      (error) => error.code === "release_matrix_revision_invalid",
    );
  });
});
