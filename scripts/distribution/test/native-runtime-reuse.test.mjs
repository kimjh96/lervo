import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("node:child_process", async (original) => ({
  ...(await original()),
  execFileSync: vi.fn(() => "a".repeat(40)),
}));
import { nativeFileSyncFixture } from "./native-file-sync-fixture.mjs";
import { nativeAddonDigest } from "../../shared/native-addon-contract.mjs";
import { nativeCasSourceHash, readNativeCasArtifact } from "../../shared/native-cas-artifact.mjs";
import { nativeFileSyncSourceHash } from "../../shared/native-file-sync-artifact.mjs";
import { darwinToolchainPin } from "../lib/darwin-toolchain.mjs";
import {
  compareNativeRuntimeReuse,
  createNativeRuntimeReuse,
  restoreNativeRuntimeReuse,
  verifyNativeRuntimeReuse,
} from "../lib/native-runtime-reuse-artifact.mjs";
import {
  nativeRuntimeReuseArtifactName,
  nativeRuntimeReuseInputs,
  nativeRuntimeReuseKey,
} from "../lib/native-runtime-reuse-key.mjs";
import { findNativeRuntimeReuseRun } from "../lib/native-runtime-reuse-source.mjs";

const node = { version: "v22.13.0", versions: { napi: "10", modules: "127" } };
const sources = [
  ...["binding.c", "cas-io.c", "cas-io.h"].map((name) => `packages/cas/native/${name}`),
  ...["build-native.mjs", "build-native-artifact.mjs"].map(
    (name) => `packages/cas/scripts/${name}`,
  ),
  ...["binding.c", "sync-group.c", "sync-group.h"].map(
    (name) => `packages/filesystem-durability/native/${name}`,
  ),
  "packages/filesystem-durability/scripts/build-native.mjs",
  ...[
    "native-cas-artifact",
    "native-cas-contract",
    "native-file-sync-artifact",
    "native-file-sync-contract",
    "native-addon-artifact",
    "native-addon-contract",
    "native-runtime-artifact",
    "native-runtime-contract",
  ].map((name) => `scripts/shared/${name}.mjs`),
];

let root, repositoryRoot, outputs;
beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), "lervo-native-reuse-"));
  repositoryRoot = resolve(root, "repository");
  vi.stubEnv("GITHUB_WORKFLOW", "Code quality");
  vi.stubEnv("GITHUB_RUN_ID", "42");
  vi.stubEnv("GITHUB_RUN_ATTEMPT", "1");
  for (const path of sources) {
    const target = resolve(repositoryRoot, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(import.meta.dirname, "../../..", path), target);
  }
  outputs = [
    {
      root: resolve(repositoryRoot, "packages/filesystem-durability/dist/native"),
      name: "file-sync",
      hash: await nativeFileSyncSourceHash(repositoryRoot),
    },
    {
      root: resolve(repositoryRoot, "packages/cas/dist/native"),
      name: "cas-io",
      hash: await nativeCasSourceHash(repositoryRoot),
    },
  ];
  await build(2);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

/** Writes both package outputs as a build would; `marker` stands for the compiler's bytes. */
async function build(marker) {
  for (const output of outputs) {
    await mkdir(output.root, { recursive: true });
    const { binary, manifest } = nativeFileSyncFixture();
    binary[111] = marker;
    manifest.sourceHash = output.hash;
    manifest.contentHash = nativeAddonDigest(binary);
    await writeFile(resolve(output.root, `${output.name}-darwin.node`), binary);
    await writeFile(resolve(output.root, `${output.name}.json`), JSON.stringify(manifest));
  }
}
const key = async (overrides = {}) =>
  nativeRuntimeReuseKey(
    await nativeRuntimeReuseInputs({ repositoryRoot, node: { ...node, ...overrides } }),
  );
const artifact = (name) => resolve(root, name);
const input = (name) => ({ repositoryRoot, artifactDirectory: artifact(name), node });

describe("native build input key", () => {
  it("is stable for identical inputs and binds the pinned toolchain and Node", async () => {
    const inputs = await nativeRuntimeReuseInputs({ repositoryRoot, node });
    expect(inputs.toolchain).toEqual({ ...darwinToolchainPin });
    expect(inputs.node).toEqual({ version: "v22.13.0", napi: "10", modules: "127" });
    expect(await key()).toBe(await key());
    expect(await key()).toMatch(/^[a-f0-9]{64}$/u);
    expect(await key({ version: "v22.14.0" })).not.toBe(await key());
    expect(await key({ versions: { napi: "10", modules: "131" } })).not.toBe(await key());
    expect(nativeRuntimeReuseArtifactName("b".repeat(64))).toBe(
      `lervo-native-runtime-${"b".repeat(64)}`,
    );
  });

  it.each([
    "packages/cas/native/cas-io.c",
    "packages/filesystem-durability/native/sync-group.h",
    "packages/cas/scripts/build-native-artifact.mjs",
    "scripts/shared/native-addon-contract.mjs",
  ])("changes when the build input %s changes", async (path) => {
    const before = await key();
    await writeFile(resolve(repositoryRoot, path), "// changed\n", { flag: "a" });
    expect(await key()).not.toBe(before);
  });

  it("changes when a native directory gains a file that the source hash lists miss", async () => {
    const before = await key();
    await mkdir(resolve(repositoryRoot, "packages/cas/native/include"));
    await writeFile(
      resolve(repositoryRoot, "packages/cas/native/include/extra.h"),
      "#pragma once\n",
    );
    expect(await key()).not.toBe(before);
  });
});

describe("reusable native build artifact", () => {
  it("installs the exact bytes of an earlier build for identical inputs", async () => {
    const receipt = await createNativeRuntimeReuse({ ...input("offered"), environment: {} });
    expect(receipt.key).toBe(await key());
    expect(receipt.producer).toEqual({
      revision: "a".repeat(40),
      workflow: "Code quality",
      runId: "42",
      runAttempt: "1",
      image: "local",
    });
    await rm(resolve(repositoryRoot, "packages/cas/dist"), { recursive: true });
    await build(9);
    expect(await restoreNativeRuntimeReuse(input("offered"))).toEqual(receipt);
    const restored = await readNativeCasArtifact(outputs[1].root, {
      expectedSourceHash: outputs[1].hash,
    });
    expect(restored.files["cas-io-darwin.node"][111]).toBe(2);
  });

  it("refuses an earlier build after a native input changed, so the caller builds", async () => {
    await createNativeRuntimeReuse(input("offered"));
    await writeFile(resolve(repositoryRoot, "packages/cas/native/cas-io.h"), "// changed\n", {
      flag: "a",
    });
    await expect(restoreNativeRuntimeReuse(input("offered"))).rejects.toThrow(
      "native_reuse_inputs_mismatch",
    );
    await expect(
      verifyNativeRuntimeReuse({ ...input("offered"), node: { ...node, version: "v24.0.0" } }),
    ).rejects.toThrow("native_reuse_inputs_mismatch");
  });

  it.each(["binary", "receipt-digest", "receipt-inputs", "extra", "missing"])(
    "rejects a changed artifact (%s) without installing it",
    async (kind) => {
      const receipt = await createNativeRuntimeReuse(input("offered"));
      const directory = artifact("offered");
      if (kind === "binary") {
        const path = resolve(directory, "native/cas-io-darwin.node");
        const binary = await readFile(path);
        binary[111]++;
        const manifestPath = resolve(directory, "native/cas-io.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        manifest.contentHash = nativeAddonDigest(binary);
        await writeFile(path, binary);
        await writeFile(manifestPath, JSON.stringify(manifest));
      } else if (kind === "receipt-digest")
        await writeFile(
          resolve(directory, "reuse.json"),
          JSON.stringify({ ...receipt, artifactDigest: `sha256:${"c".repeat(64)}` }),
        );
      else if (kind === "receipt-inputs")
        await writeFile(
          resolve(directory, "reuse.json"),
          JSON.stringify({ ...receipt, inputs: { ...receipt.inputs, schemaVersion: 2 } }),
        );
      else if (kind === "extra") await writeFile(resolve(directory, "extra"), "x");
      else await rm(resolve(directory, "native/file-sync.json"));
      await build(7);
      await expect(restoreNativeRuntimeReuse(input("offered"))).rejects.toThrow();
      const current = await readNativeCasArtifact(outputs[1].root);
      expect(current.files["cas-io-darwin.node"][111]).toBe(7);
    },
  );

  it("passes the audit only when a fresh build reproduces the offered bytes", async () => {
    await createNativeRuntimeReuse(input("earlier"));
    await createNativeRuntimeReuse(input("fresh"));
    await expect(
      compareNativeRuntimeReuse({
        repositoryRoot,
        freshDirectory: artifact("fresh"),
        reusedDirectory: artifact("earlier"),
        node,
      }),
    ).resolves.toBeDefined();
    await build(5);
    await createNativeRuntimeReuse(input("different"));
    await expect(
      compareNativeRuntimeReuse({
        repositoryRoot,
        freshDirectory: artifact("different"),
        reusedDirectory: artifact("earlier"),
        node,
      }),
    ).rejects.toThrow("native_reuse_not_reproduced");
  });
});

describe("main build lookup", () => {
  const repository = "owner/repo";
  const lookupKey = "d".repeat(64);
  const name = nativeRuntimeReuseArtifactName(lookupKey);
  const artifact = (id, runId, created_at, extra = {}) => ({
    id,
    name,
    expired: false,
    created_at,
    workflow_run: { id: runId },
    ...extra,
  });
  const mainRun = {
    path: ".github/workflows/code-quality.yml",
    status: "completed",
    conclusion: "success",
    event: "push",
    head_branch: "main",
    repository: { full_name: repository },
    head_repository: { full_name: repository },
  };
  const nativeSucceeded = [{ name: "Native runtime artifacts", conclusion: "success" }];
  /** GitHub's record: artifact pages by name, each run, and each run's latest jobs. */
  function api({ artifacts, pages, runs = {}, jobs = {} } = {}) {
    const calls = [];
    const request = (path) => {
      calls.push(path);
      if (path.startsWith(`repos/${repository}/actions/artifacts?name=${name}&per_page=100`)) {
        const page = Number(new URLSearchParams(path.split("?")[1]).get("page"));
        if (pages) return { artifacts: pages[page - 1] ?? [] };
        return { artifacts: page === 1 ? (artifacts ?? [artifact(5, 11, "2026-11-18")]) : [] };
      }
      const run = path.match(/^repos\/owner\/repo\/actions\/runs\/(\d+)$/u);
      if (run) return { ...mainRun, ...runs[run[1]] };
      const job = path.match(/^repos\/owner\/repo\/actions\/runs\/(\d+)\/jobs\?filter=latest/u);
      if (job) return { jobs: jobs[job[1]] ?? nativeSucceeded };
      throw new Error(`unexpected ${path}`);
    };
    return { calls, request };
  }
  const find = (fixture) => findNativeRuntimeReuseRun({ repository, key: lookupKey, ...fixture });
  const found = (runId, artifactId) => ({
    status: "found",
    runId,
    artifactId,
    artifactName: name,
  });

  it("accepts a build on main whose native job succeeded, even before the run ends", () => {
    for (const event of ["push", "schedule", "workflow_dispatch"]) {
      const runs = { 11: { event, status: "in_progress", conclusion: null } };
      expect(find(api({ runs }))).toEqual(found(11, 5));
    }
  });

  it("rejects a successful pull-request run, whose workflow the branch controls", () => {
    // A branch can rewrite its workflow so the native job succeeds and uploads crafted bytes
    // under main's computable key; its run conclusion proves nothing about their origin.
    const runs = { 11: { event: "pull_request", head_branch: "feature" } };
    expect(find(api({ runs }))).toEqual({ status: "none" });
    const dispatchedBranch = { 11: { event: "workflow_dispatch", head_branch: "feature" } };
    expect(find(api({ runs: dispatchedBranch }))).toEqual({ status: "none" });
  });

  it.each([
    [
      "a pull request whose head branch is called main",
      { runs: { 11: { event: "pull_request" } } },
    ],
    ["a fork", { runs: { 11: { head_repository: { full_name: "fork/repo" } } } }],
    ["another workflow", { runs: { 11: { path: ".github/workflows/cli-release-matrix.yml" } } }],
    [
      "a failed native job",
      { jobs: { 11: [{ name: "Native runtime artifacts", conclusion: "failure" }] } },
    ],
    ["a missing native job", { jobs: { 11: [] } }],
    ["an expired artifact", { artifacts: [artifact(5, 11, "2026-11-18", { expired: true })] }],
    ["no artifact for these inputs", { artifacts: [] }],
  ])("rejects %s, so the caller builds", (_label, fixture) => {
    expect(find(api(fixture))).toEqual({ status: "none" });
  });

  it("prefers the newest main build and looks past branch artifacts on later pages", () => {
    const branchRuns = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [
        String(100 + index),
        { event: "pull_request", head_branch: "feature" },
      ]),
    );
    const pages = [
      Array.from({ length: 100 }, (_, index) =>
        artifact(1000 + index, 100 + index, `2026-11-18T09:${String(index % 60).padStart(2, "0")}`),
      ),
      [artifact(7, 12, "2026-11-16"), artifact(8, 13, "2026-11-17")],
    ];
    expect(find(api({ pages, runs: branchRuns }))).toEqual(found(13, 8));
  });

  it("reports an API failure apart from a miss, and treats invalid coordinates as a miss", () => {
    expect(
      find({
        request: () => {
          throw new Error("rate limited");
        },
      }),
    ).toEqual({ status: "unavailable" });
    expect(findNativeRuntimeReuseRun({ ...api(), repository: "bad repo", key: lookupKey })).toEqual(
      { status: "none" },
    );
    expect(findNativeRuntimeReuseRun({ ...api(), repository, key: "short" })).toEqual({
      status: "none",
    });
  });
});
