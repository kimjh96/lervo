import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import {
  computeCiTestToolchainDigest,
  observeCiTestToolchain,
} from "../lib/ci-test-toolchain-digest.mjs";

let root;
const environment = {
  ImageOS: "ubuntu24",
  ImageVersion: "20261110.1",
  npm_config_user_agent: "pnpm/11.18.0 npm/? node/v22.13.0 linux x64",
};
const workflow = (step) => `
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Run tests
        run: ${step}
`;
const files = {
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  "package.json": '{"name":"root","private":true}',
  "apps/cli/package.json": '{"name":"@lervo/cli","version":"0.1.0"}',
  "packages/core/package.json": '{"name":"@lervo/core"}',
  "tsconfig.json": "{}",
  "vitest.config.ts": "export default {};\n",
  "scripts/quality/lib/ci-test-input-recorder.cjs": "// recorder\n",
  "scripts/quality/lib/ci-test-shadow-prediction.mjs": "// shadow predictor\n",
  "scripts/quality/lib/test-user-state-isolation.mjs": "// setup\n",
  ".github/workflows/code-quality.yml": workflow("pnpm test"),
};

beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), "lervo-ci-toolchain-"));
  for (const [path, content] of Object.entries(files)) await write(path, content);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(path, content) {
  await mkdir(dirname(resolve(root, path)), { recursive: true });
  await writeFile(resolve(root, path), content);
}

const digest = async (overrides = {}) =>
  computeCiTestToolchainDigest({
    repositoryRoot: root,
    tracked: Object.keys(files),
    setupFiles: ["scripts/quality/lib/test-user-state-isolation.mjs"],
    environment: { ...environment, ...overrides },
  });

it("is stable for the same toolchain and ignores the CLI version and workflow layout", async () => {
  const first = await digest();
  expect(first.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  expect(await digest()).toEqual(first);
  expect(first.components.runtime).toMatch(/^node v\d+\.\d+\.\d+; pnpm 11\.18\.0; /u);
  expect(first.components.platform).toBe(`ubuntu24 20261110.1 ${process.arch}`);
  expect(first.components.nativeArtifacts).toBe("absent");
  expect(JSON.stringify(first)).not.toContain(root);

  await write("apps/cli/package.json", '{"name":"@lervo/cli","version":"0.2.0"}');
  await write(
    ".github/workflows/code-quality.yml",
    "# reformatted\njobs:\n  test:\n    steps: [{ run: pnpm test, name: Run tests }]\n    runs-on: ubuntu-latest\n",
  );
  // The shadow predictor only reads finished ledgers, so changing it invalidates nothing.
  await write("scripts/quality/lib/ci-test-shadow-prediction.mjs", "// changed shadow predictor\n");
  expect((await digest()).digest).toBe(first.digest);
  // Variables that differ on every run or revision stay out, so G can match between runs.
  const perRun = (value) => ({
    GITHUB_RUN_ID: value,
    GITHUB_SHA: value,
    ACTIONS_ORCHESTRATION_ID: value,
    INVOCATION_ID: value,
    JOURNAL_STREAM: value,
    SYSTEMD_EXEC_PID: value,
    MEMORY_PRESSURE_WATCH: value,
  });
  expect((await digest(perRun("1"))).digest).toBe((await digest(perRun("2"))).digest);
  // The cloud a runner came from is a real difference, so it stays in G.
  expect((await digest({ HCA_CLOUD_PROVIDER: "AWS" })).digest).not.toBe(
    (await digest({ HCA_CLOUD_PROVIDER: "Azure" })).digest,
  );
  expect(JSON.stringify(await digest({ SECRET_VALUE: "do-not-store" }))).not.toContain(
    "do-not-store",
  );
});

it("changes with every toolchain component", async () => {
  const { digest: base } = await digest();
  const changed = [];
  for (const [path, content] of [
    ["pnpm-lock.yaml", "lockfileVersion: '9.1'\n"],
    ["packages/core/package.json", '{"name":"@lervo/core","type":"module"}'],
    ["tsconfig.json", '{"compilerOptions":{"strict":true}}'],
    ["scripts/quality/lib/test-user-state-isolation.mjs", "// changed setup\n"],
    ["scripts/quality/lib/ci-test-input-recorder.cjs", "// changed recorder\n"],
    [".github/workflows/code-quality.yml", workflow("pnpm test --shard=1/4")],
    ["packages/cas/dist/native/cas.node", "binary"],
  ]) {
    const original = files[path];
    await write(path, content);
    changed.push((await digest()).digest);
    if (original === undefined) await rm(resolve(root, path));
    else await write(path, original);
  }
  changed.push((await digest({ ImageVersion: "20261117.1" })).digest);
  changed.push((await digest({ npm_config_user_agent: "pnpm/11.19.0" })).digest);
  changed.push((await digest({ NODE_OPTIONS: "--conditions=development" })).digest);
  changed.push((await digest({ GITHUB_REF: "refs/heads/feature" })).digest);
  expect(new Set([base, ...changed]).size).toBe(changed.length + 1);
});

it("observes the kernel and every variable's value digest outside G, withholding credentials", () => {
  const observed = observeCiTestToolchain({ PATH: "/usr/bin", GH_TOKEN: "do-not-store" });
  expect(observed.kernel).toEqual(expect.any(String));
  expect(observed.environmentValues).toEqual({
    GH_TOKEN: "withheld",
    PATH: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
  });
  expect(JSON.stringify(observed)).not.toContain("/usr/bin");
});
