import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { createCiTestInputIndex, readCiTestInputIndex } from "../lib/ci-test-shadow-index.mjs";
import { createCiTestInputSnapshot } from "../lib/ci-test-shadow-inputs.mjs";
import {
  CI_TEST_RERUN_REASONS,
  CI_TEST_SHADOW_TTL_MS,
  predictCiTestReuse,
} from "../lib/ci-test-shadow-prediction.mjs";

const hour = 60 * 60 * 1000;
const now = Date.parse("2026-11-15T12:00:00Z");
const G = "sha256:toolchain";
const testFile = "packages/core/test/core.test.ts";
const headToolchain = {
  digest: G,
  components: { lockfile: "sha256:lock", platform: "ubuntu24 20261111.370.1 x64" },
};
let root;

beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), "lervo-ci-shadow-"));
  await write(testFile, "test\n");
  await write("packages/core/src/index.ts", "export const value = 1;\n");
  await write("packages/core/dist/index.js", "export const value = 1;\n");
  await write("packages/core/test/fixtures/a.json", "{}\n");
  await write("packages/core/scripts/run.sh", "#!/bin/sh\n");
  await write("templates/one.md", "one\n");
  await symlink("../packages/core", resolve(root, "linked-core"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(path, content) {
  await mkdir(dirname(resolve(root, path)), { recursive: true });
  await writeFile(resolve(root, path), content);
}

/** The recorded closure of `testFile`, as a ledger would resolve it. */
function record(overrides = {}) {
  return {
    file: testFile,
    shard: 1,
    observedAt: now - hour,
    result: "passed",
    tests: { passed: 2, failed: 0, skipped: 0, pending: 0 },
    durationMs: 100,
    collectMs: 50,
    inputs: ["packages/core/src/index.ts", "packages/core/dist/index.js", "linked-core"],
    trees: ["templates"],
    absent: ["packages/core/missing.json"],
    directories: [["packages/core/test/fixtures", []]],
    uncacheableReasons: [],
    toolchainDigest: G,
    toolchainComponents: { lockfile: "sha256:lock", platform: "ubuntu24 20261111.370.1 x64" },
    ...overrides,
  };
}

/** One earlier run, with its input index taken from the tree as it is now. */
function historyRun({ id = "1", trusted = true, files = [record()], indexed = true } = {}) {
  const snapshot = createCiTestInputSnapshot(root);
  for (const file of files)
    file.directories = file.directories.map(([path, digests]) => [
      path,
      digests.length > 0 ? digests : [snapshot.listing(path, false)],
    ]);
  const index = createCiTestInputIndex({ run: { id, revision: "a".repeat(40) }, files, snapshot });
  return {
    run: { id, trusted, availableAt: now - hour / 2 },
    files: new Map(files.map((file) => [file.file, file])),
    index: indexed ? readCiTestInputIndex(JSON.parse(JSON.stringify(index))) : null,
  };
}

const predict = (history, overrides = {}) =>
  predictCiTestReuse({
    files: [{ file: testFile, toolchain: headToolchain }],
    history,
    head: createCiTestInputSnapshot(root),
    now,
    ...overrides,
  }).get(testFile);

it("reuses a trusted result when every recorded input is unchanged at the head", () => {
  expect(predict([historyRun()])).toEqual({
    reuse: true,
    run: "1",
    tests: { passed: 2, failed: 0, skipped: 0, pending: 0 },
  });
});

it.each([
  [
    "a source edit",
    () => write("packages/core/src/index.ts", "export const value = 2;\n"),
    "input_changed",
    "packages/core/src/index.ts",
  ],
  [
    "a rebuilt output",
    () => write("packages/core/dist/index.js", "export const value = 2;\n"),
    "input_changed",
    "packages/core/dist/index.js",
  ],
  ["the test file itself", () => write(testFile, "changed\n"), "input_changed", testFile],
  [
    "a deleted input",
    () => rm(resolve(root, "packages/core/src/index.ts")),
    "input_changed",
    "packages/core/src/index.ts",
  ],
  [
    "an executable bit",
    () => chmod(resolve(root, "packages/core/dist/index.js"), 0o755),
    "input_changed",
    "packages/core/dist/index.js",
  ],
  [
    "a retargeted link",
    async () => {
      await rm(resolve(root, "linked-core"));
      await symlink("../templates", resolve(root, "linked-core"));
    },
    "input_changed",
    "linked-core",
  ],
  [
    "a file inside a copied tree",
    () => write("templates/one.md", "changed\n"),
    "tree_changed",
    "templates",
  ],
  [
    "a new file in a copied tree",
    () => write("templates/two.md", "two\n"),
    "tree_changed",
    "templates",
  ],
  [
    "a new entry in a listed directory",
    () => write("packages/core/test/fixtures/b.json", "{}\n"),
    "listing_changed",
    "packages/core/test/fixtures",
  ],
  [
    "a probed path that now exists",
    () => write("packages/core/missing.json", "{}\n"),
    "absent_path_appeared",
    "packages/core/missing.json",
  ],
])("reruns after %s", async (_name, change, reason, path) => {
  const history = [historyRun()];
  await change();
  expect(predict(history)).toEqual({ reuse: false, reason, detail: path, run: "1" });
});

it("matches a recursive listing and reruns when a nested entry appears", async () => {
  const recursive = () =>
    record({
      directories: [
        ["packages/core", [createCiTestInputSnapshot(root).listing("packages/core", true)]],
      ],
    });
  const history = [historyRun({ files: [recursive()] })];
  await write("packages/core/src/index.ts", "export const value = 1; // same names\n");
  expect(predict(history)).toMatchObject({ reuse: false, reason: "input_changed" });
  await write("packages/core/src/index.ts", "export const value = 1;\n");
  expect(predict(history).reuse).toBe(true);
  await write("packages/core/src/nested/new.ts", "\n");
  expect(predict(history)).toMatchObject({ reason: "listing_changed", detail: "packages/core" });
});

it("keeps a listing match when only file contents below it change", async () => {
  const history = [historyRun()];
  await write("packages/core/test/fixtures/a.json", '{"changed":true}\n');
  expect(predict(history).reuse).toBe(true);
});

it("reruns after the TTL, a toolchain change, an unpassed or uncacheable result, or without an index", () => {
  expect(
    predict([historyRun({ files: [record({ observedAt: now - CI_TEST_SHADOW_TTL_MS - 1 })] })]),
  ).toMatchObject({ reason: "history_expired" });
  expect(predict([historyRun({ files: [record({ observedAt: Number.NaN })] })])).toMatchObject({
    reason: "history_expired",
  });
  // Another runner image build of the same release is another toolchain, and the reason says so.
  const otherImage = record({
    toolchainDigest: "sha256:other",
    toolchainComponents: { lockfile: "sha256:lock", platform: "ubuntu24 20261111.127.1 x64" },
  });
  expect(predict([historyRun({ files: [otherImage] })])).toEqual({
    reuse: false,
    reason: "toolchain_changed",
    detail: "platform",
    run: "1",
  });
  const unknown = record({ toolchainDigest: "sha256:other", toolchainComponents: null });
  expect(predict([historyRun({ files: [unknown] })])).toMatchObject({ detail: "unknown" });
  expect(predict([historyRun({ files: [record({ result: "skipped" })] })])).toMatchObject({
    reason: "not_passed",
  });
  expect(
    predict([historyRun({ files: [record({ uncacheableReasons: ["host_state", "network"] })] })]),
  ).toMatchObject({ reason: "uncacheable_host_state" });
  expect(predict([historyRun({ indexed: false })])).toMatchObject({
    reason: "input_digests_unavailable",
  });
});

it("never reuses an untrusted run or a run that finished after the current run started", () => {
  expect(predict([historyRun({ trusted: false })])).toEqual({
    reuse: false,
    reason: "untrusted_history",
  });
  const late = historyRun();
  late.run.availableAt = now + 1;
  expect(predict([late])).toEqual({ reuse: false, reason: "no_history" });
  expect(predict([])).toEqual({ reuse: false, reason: "no_history" });
});

it("revokes reuse after any failure under the same toolchain within the TTL, trusted or not", () => {
  const failed = historyRun({
    id: "2",
    trusted: false,
    files: [record({ result: "failed", observedAt: now - 2 * hour })],
  });
  expect(predict([historyRun(), failed])).toEqual({
    reuse: false,
    reason: "prior_failure",
    run: "2",
  });
  const otherToolchain = historyRun({
    id: "3",
    trusted: false,
    files: [record({ result: "failed", toolchainDigest: "sha256:other" })],
  });
  expect(predict([historyRun(), otherToolchain]).reuse).toBe(true);
  const expired = historyRun({
    id: "4",
    files: [record({ result: "failed", observedAt: now - CI_TEST_SHADOW_TTL_MS - 1 })],
  });
  expect(predict([historyRun(), expired]).reuse).toBe(true);
});

it("tries candidates newest first and reports the newest candidate's reason", async () => {
  const older = historyRun({ id: "1", files: [record({ observedAt: now - 3 * hour })] });
  await write("packages/core/src/index.ts", "export const value = 2;\n");
  const newer = historyRun({ id: "2", files: [record({ observedAt: now - hour })] });
  expect(predict([older, newer])).toMatchObject({ reuse: true, run: "2" });
  await write("packages/core/src/index.ts", "export const value = 3;\n");
  expect(predict([older, newer])).toEqual({
    reuse: false,
    reason: "input_changed",
    detail: "packages/core/src/index.ts",
    run: "2",
  });
});

it("never matches an unreadable digest and never trusts a missing index entry", () => {
  const unreadable = historyRun();
  unreadable.index.inputs.set("packages/core/src/index.ts", "unreadable");
  expect(predict([unreadable])).toMatchObject({
    reason: "input_changed",
    detail: "packages/core/src/index.ts",
  });
  const partial = historyRun();
  partial.index.inputs.delete("packages/core/dist/index.js");
  expect(predict([partial])).toMatchObject({
    reason: "input_digests_unavailable",
    detail: "packages/core/dist/index.js",
  });
  const listed = historyRun({
    files: [record({ directories: [["packages/core/test/fixtures", ["unlisted"]]] })],
  });
  expect(predict([listed])).toMatchObject({ reason: "listing_changed" });
});

it("names every reason from its closed list", () => {
  expect(new Set(CI_TEST_RERUN_REASONS).size).toBe(CI_TEST_RERUN_REASONS.length);
  expect(CI_TEST_RERUN_REASONS).toContain("uncacheable_module_graph_unavailable");
});
