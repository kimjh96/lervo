import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { parse } from "yaml";
vi.mock("node:child_process", async (original) => ({
  ...(await original()),
  execFileSync: vi.fn(() => "a".repeat(40)),
}));

import { nativeFileSyncFixture } from "../../distribution/test/native-file-sync-fixture.mjs";
import {
  createNativeRuntimeReuse,
  verifyNativeRuntimeReuse,
} from "../../distribution/lib/native-runtime-reuse-artifact.mjs";
import {
  nativeRuntimeReuseArtifactName,
  nativeRuntimeReuseInputs,
  nativeRuntimeReuseKey,
} from "../../distribution/lib/native-runtime-reuse-key.mjs";
import { findNativeRuntimeReuseRun } from "../../distribution/lib/native-runtime-reuse-source.mjs";
import { darwinToolchainPin } from "../../distribution/lib/darwin-toolchain.mjs";
import { nativeAddonDigest } from "../../shared/native-addon-contract.mjs";
import { nativeCasSourceHash, readNativeCasArtifact } from "../../shared/native-cas-artifact.mjs";
import { nativeFileSyncSourceHash } from "../../shared/native-file-sync-artifact.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const readWorkflow = async (name) =>
  parse(await readFile(resolve(repositoryRoot, ".github/workflows", name), "utf8"));
const preparation = await readWorkflow("release-preparation.yml");
const routeSteps = preparation.jobs.route.steps;
const reconcileSteps = preparation.jobs.reconcile.steps;
const fixturePaths = [
  "scripts/distribution/native-runtime-reuse.mjs",
  "scripts/distribution/lib",
  "scripts/shared",
  "packages/cas/native",
  "packages/cas/scripts",
  "packages/filesystem-durability/native",
  "packages/filesystem-durability/scripts",
];
const repository = "owner/repo";
const shellPath = `${dirname(process.execPath)}:${process.env.PATH}`;

let root, fixtureRoot, offered, publishedArtifact;

async function writeBuiltOutputs(marker) {
  for (const [directory, name, hash] of [
    [
      "packages/filesystem-durability/dist/native",
      "file-sync",
      await nativeFileSyncSourceHash(fixtureRoot),
    ],
    ["packages/cas/dist/native", "cas-io", await nativeCasSourceHash(fixtureRoot)],
  ]) {
    const output = resolve(fixtureRoot, directory);
    await mkdir(output, { recursive: true });
    const { binary, manifest } = nativeFileSyncFixture();
    binary[111] = marker;
    manifest.sourceHash = hash;
    manifest.contentHash = nativeAddonDigest(binary);
    await writeFile(resolve(output, `${name}-darwin.node`), binary);
    await writeFile(resolve(output, `${name}.json`), JSON.stringify(manifest));
  }
}

/** GitHub's record: run 7, a Code quality push on main, published only `publishedArtifact`. */
function request(path) {
  if (path.startsWith(`repos/${repository}/actions/artifacts?name=`)) {
    const name = new URLSearchParams(path.split("?")[1]).get("name");
    return {
      artifacts:
        name === publishedArtifact
          ? [{ id: 70, name, expired: false, created_at: "2026-11-18", workflow_run: { id: 7 } }]
          : [],
    };
  }
  if (path === `repos/${repository}/actions/runs/7`)
    return {
      path: ".github/workflows/code-quality.yml",
      status: "completed",
      conclusion: "success",
      event: "push",
      head_branch: "main",
      repository: { full_name: repository },
      head_repository: { full_name: repository },
    };
  if (path.startsWith(`repos/${repository}/actions/runs/7/jobs`))
    return { jobs: [{ name: "Native runtime artifacts", conclusion: "success" }] };
  throw new Error(`unexpected ${path}`);
}

function runStep(step, { env = {}, cwd = fixtureRoot } = {}) {
  const output = resolve(root, `output-${Math.random().toString(16).slice(2)}`);
  const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", step.run], {
    cwd,
    encoding: "utf8",
    env: { PATH: shellPath, RUNNER_TEMP: root, GITHUB_OUTPUT: output, ...env },
  });
  let written = "";
  try {
    written = readFileSync(output, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const outputs = Object.fromEntries(
    written
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("=")),
  );
  return { status: result.status, stderr: result.stderr, outputs };
}

/** Follows the route job: intent, then find, download, and verify only when the earlier step allows. */
async function route({ pending, offeredDirectory = offered, api = request }) {
  if (pending) await writeFile(resolve(fixtureRoot, ".changes/relint_fixture.yaml"), "intent\n");
  const intent = runStep(routeSteps.find((step) => step.id === "intent"));
  assert.equal(intent.outputs.pending, String(pending));
  let found = null;
  let verified = "skipped";
  if (intent.outputs.pending === "true") {
    const key = nativeRuntimeReuseKey(
      await nativeRuntimeReuseInputs({ repositoryRoot: fixtureRoot }),
    );
    found = findNativeRuntimeReuseRun({ repository, key, request: api });
    if (found.status === "found")
      verified = await verifyNativeRuntimeReuse({
        repositoryRoot: fixtureRoot,
        artifactDirectory: offeredDirectory,
      }).then(
        () => "success",
        () => "failure",
      );
  }
  return runStep(routeSteps.at(-1), {
    env: {
      PENDING: intent.outputs.pending,
      VERIFIED: verified,
      NATIVE_RUN: found?.runId ? String(found.runId) : "",
    },
  }).outputs;
}

beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), "lervo-release-native-reuse-"));
  fixtureRoot = resolve(root, "repository");
  for (const path of fixturePaths)
    await cp(resolve(repositoryRoot, path), resolve(fixtureRoot, path), { recursive: true });
  await mkdir(resolve(fixtureRoot, ".changes"));
  await writeBuiltOutputs(2);
  offered = resolve(root, "offered");
  const receipt = await createNativeRuntimeReuse({
    repositoryRoot: fixtureRoot,
    artifactDirectory: offered,
  });
  publishedArtifact = nativeRuntimeReuseArtifactName(receipt.key);
  await rm(resolve(fixtureRoot, "packages/cas/dist"), { recursive: true });
  await rm(resolve(fixtureRoot, "packages/filesystem-durability/dist"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("release preparation darwin native reuse", () => {
  it("prepares on Linux with the verified build when no native input changed", async () => {
    assert.deepEqual(await route({ pending: true }), {
      runner: "ubuntu-latest",
      nativeRun: "7",
    });
  });

  it("prepares on the pinned macOS image when a native input changed", async () => {
    await writeFile(resolve(fixtureRoot, "packages/cas/native/cas-io.c"), "/* changed */\n", {
      flag: "a",
    });
    assert.deepEqual(await route({ pending: true }), { runner: darwinToolchainPin.runner });
  });

  it.each([
    ["no artifact", { api: () => ({ artifacts: [] }) }],
    [
      "an API failure",
      {
        api: () => {
          throw new Error("unavailable");
        },
      },
    ],
    ["a download that fails validation", { offeredDirectory: resolve(tmpdir(), "missing") }],
    [
      "a valid build that a pull-request branch published",
      {
        // The bytes and key are right, but a branch run controls its own workflow, so its
        // artifact never decides what preparation commits.
        api: (path) =>
          path === `repos/${repository}/actions/runs/7`
            ? { ...request(path), event: "pull_request", head_branch: "feature" }
            : request(path),
      },
    ],
  ])("prepares on the pinned macOS image after a cache miss: %s", async (_label, options) => {
    assert.deepEqual(await route({ pending: true, ...options }), {
      runner: darwinToolchainPin.runner,
    });
  });

  it("falls back to the pinned macOS image when the route job fails before deciding", () => {
    const reconcile = preparation.jobs.reconcile;
    assert.equal(
      reconcile["runs-on"],
      `\${{ needs.route.outputs.runner || '${darwinToolchainPin.runner}' }}`,
    );
    // Without `!cancelled()`, a failed route job would skip the reconcile entirely.
    assert.ok(reconcile.if.startsWith("!cancelled() && "));
    assert.equal(reconcile.if.slice("!cancelled() && ".length), preparation.jobs.route.if);
  });

  it("creates a tag on Linux without looking for native files", async () => {
    assert.deepEqual(await route({ pending: false }), { runner: "ubuntu-latest" });
    for (const id of ["find", "download", "verify"]) {
      const step = routeSteps.find((candidate) => candidate.id === id);
      assert.equal(step["continue-on-error"], true, id);
    }
    assert.equal(
      routeSteps.find((step) => step.id === "find").if,
      "steps.intent.outputs.pending == 'true'",
    );
    assert.equal(
      routeSteps.find((step) => step.id === "download").if,
      "steps.find.outputs.run != ''",
    );
    assert.equal(
      routeSteps.find((step) => step.id === "verify").if,
      "steps.download.outcome == 'success'",
    );
    assert.deepEqual(preparation.jobs.route.permissions, { contents: "read", actions: "read" });
  });

  it("restores the verified build before Linux preparation and fails closed without it", async () => {
    const names = reconcileSteps.map((step) => step.name);
    const download = reconcileSteps[names.indexOf("Download the verified native build")];
    const restore = reconcileSteps[names.indexOf("Restore the verified native build")];
    assert.equal(
      download.if,
      "steps.admission.outputs.status == 'ready' && needs.route.outputs.nativeRun != ''",
    );
    assert.equal(download.with["run-id"], "${{ needs.route.outputs.nativeRun }}");
    assert.equal(download.with.name, "${{ needs.route.outputs.nativeArtifact }}");
    assert.equal(restore.if, "steps.admission.outputs.status == 'ready' && runner.os != 'macOS'");
    assert.ok(names.indexOf("Install dependencies") < names.indexOf(download.name));
    assert.ok(names.indexOf(download.name) < names.indexOf(restore.name));
    assert.ok(
      restore && names.indexOf(restore.name) < names.indexOf("Check source release completion"),
    );

    await writeFile(resolve(fixtureRoot, ".changes/relint_fixture.yaml"), "intent\n");
    // Without the downloaded build, Linux preparation stops before any build or commit.
    assert.notEqual(runStep(restore).status, 0);
    await cp(offered, resolve(root, "native-runtime-reuse"), { recursive: true });
    const restored = runStep(restore);
    assert.equal(restored.status, 0, restored.stderr);
    const cas = await readNativeCasArtifact(resolve(fixtureRoot, "packages/cas/dist/native"), {
      expectedSourceHash: await nativeCasSourceHash(fixtureRoot),
    });
    assert.equal(cas.files["cas-io-darwin.node"][111], 2);
  });

  it("leaves a tag-only Linux reconcile without native files", async () => {
    const restore = reconcileSteps.find(
      (step) => step.name === "Restore the verified native build",
    );
    assert.equal(runStep(restore).status, 0);
    assert.equal(
      await readNativeCasArtifact(resolve(fixtureRoot, "packages/cas/dist/native")),
      undefined,
    );
  });

  it("keeps the release matrix compiling darwin files from the exact tree", async () => {
    const matrix = await readWorkflow("cli-release-matrix.yml");
    assert.doesNotMatch(JSON.stringify(matrix.jobs), /native-runtime-reuse/u);
    assert.ok(
      matrix.jobs["native-runtime"].steps.some((step) =>
        step.run?.includes("packages/cas/scripts/build-native.mjs"),
      ),
    );
  });
});
