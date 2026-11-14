import { afterEach, beforeEach, expect, it } from "vitest";

import { CI_TEST_RERUN_REASONS, CI_TEST_SHADOW_TTL_MS } from "../lib/ci-test-shadow-prediction.mjs";
import {
  createShadowHarness,
  hour,
  now,
  passed,
  testFile,
} from "./fixtures/ci-test-shadow-harness.mjs";

let shadow;
const closure = () =>
  shadow.record({
    inputs: ["packages/core/src/index.ts"],
    listings: [["packages/core/test/fixtures", "plain"]],
    absent: ["packages/core/missing.json"],
  });

beforeEach(() => {
  shadow = createShadowHarness();
  shadow.write("packages/core/src/index.ts", "export const value = 1;\n");
  shadow.write("packages/core/test/fixtures/a.json", "{}\n");
});
afterEach(() => shadow.remove());

it("reuses a trusted result when every recorded input is unchanged at the head", () => {
  expect(shadow.predict([shadow.historyRun({ files: [closure()] })])).toEqual({
    reuse: true,
    run: "1",
    tests: passed,
  });
});

it("reruns after the TTL, a toolchain change, an outdated ledger, an unpassed or uncacheable record, or without an index", () => {
  const run = (overrides, options) =>
    shadow.historyRun({ files: [shadow.record(overrides)], ...options });
  expect(shadow.predict([run({ observedAt: now - CI_TEST_SHADOW_TTL_MS - 1 })])).toMatchObject({
    reason: "history_expired",
  });
  expect(shadow.predict([run({ observedAt: Number.NaN })])).toMatchObject({
    reason: "history_expired",
  });
  expect(shadow.predict([run({ contract: "lervo-ci-test-ledger-v1" })])).toMatchObject({
    reason: "ledger_outdated",
  });
  // Another runner image build of the same release is another toolchain, and the reason says so.
  const otherImage = {
    toolchainDigest: "sha256:other",
    toolchainComponents: { lockfile: "sha256:lock", platform: "ubuntu24 20261111.127.1 x64" },
  };
  expect(shadow.predict([run(otherImage)])).toEqual({
    reuse: false,
    reason: "toolchain_changed",
    detail: "platform",
    run: "1",
  });
  expect(
    shadow.predict([run({ toolchainDigest: "sha256:other", toolchainComponents: null })]),
  ).toMatchObject({ detail: "unknown" });
  expect(shadow.predict([run({ result: "skipped" })])).toMatchObject({ reason: "not_passed" });
  expect(
    shadow.predict([run({ uncacheableReasons: ["shard_written_input", "network"] })]),
  ).toMatchObject({ reason: "uncacheable_shard_written_input" });
  expect(shadow.predict([run({}, { indexed: false })])).toMatchObject({
    reason: "input_digests_unavailable",
  });
});

it("reruns every file when any run of the history window could not be loaded", () => {
  expect(shadow.predict([shadow.historyRun({ files: [closure()] })], { complete: false })).toEqual({
    reuse: false,
    reason: "history_incomplete",
  });
});

it("never reuses an untrusted run or a run that finished after the current run started", () => {
  expect(shadow.predict([shadow.historyRun({ trusted: false })])).toEqual({
    reuse: false,
    reason: "untrusted_history",
  });
  const late = shadow.historyRun();
  late.run.availableAt = now + 1;
  expect(shadow.predict([late])).toEqual({ reuse: false, reason: "no_history" });
  expect(shadow.predict([])).toEqual({ reuse: false, reason: "no_history" });
});

it("revokes reuse after any unpassed result under the same toolchain within the TTL, trusted or not", () => {
  const failed = (id, overrides) =>
    shadow.historyRun({
      id,
      trusted: false,
      files: [shadow.record({ result: "failed", observedAt: now - 2 * hour, ...overrides })],
    });
  expect(shadow.predict([shadow.historyRun(), failed("2")])).toEqual({
    reuse: false,
    reason: "prior_failure",
    run: "2",
  });
  // A file whose run was cancelled before it finished has no verdict, which also revokes.
  expect(shadow.predict([shadow.historyRun(), failed("5", { result: "pending" })])).toMatchObject({
    reason: "prior_failure",
  });
  expect(
    shadow.predict([shadow.historyRun(), failed("3", { toolchainDigest: "sha256:other" })]).reuse,
  ).toBe(true);
  expect(
    shadow.predict([
      shadow.historyRun(),
      failed("4", { observedAt: now - CI_TEST_SHADOW_TTL_MS - 1 }),
    ]).reuse,
  ).toBe(true);
});

it("tries candidates newest first and reports the newest candidate's reason", () => {
  const older = shadow.historyRun({
    id: "1",
    files: [shadow.record({ inputs: ["packages/core/src/index.ts"], observedAt: now - 3 * hour })],
  });
  shadow.write("packages/core/src/index.ts", "export const value = 2;\n");
  const newer = shadow.historyRun({
    id: "2",
    files: [shadow.record({ inputs: ["packages/core/src/index.ts"] })],
  });
  expect(shadow.predict([older, newer])).toMatchObject({ reuse: true, run: "2" });
  shadow.write("packages/core/src/index.ts", "export const value = 3;\n");
  expect(shadow.predict([older, newer])).toEqual({
    reuse: false,
    reason: "input_changed",
    detail: "packages/core/src/index.ts",
    run: "2",
  });
});

it("reruns a closure that names a run-unique variable in its sources", () => {
  shadow.write("packages/core/src/ci.ts", "export const run = process.env.GITHUB_RUN_ID;\n");
  expect(
    shadow.predict([
      shadow.historyRun({ files: [shadow.record({ inputs: ["packages/core/src/ci.ts"] })] }),
    ]),
  ).toMatchObject({ reason: "run_environment_read", detail: "packages/core/src/ci.ts" });
  // Only a whole token names a variable.
  shadow.write("packages/core/src/near.ts", "export const MY_GITHUB_SHA_LIKE = 1;\n");
  expect(
    shadow.predict([
      shadow.historyRun({ files: [shadow.record({ inputs: ["packages/core/src/near.ts"] })] }),
    ]).reuse,
  ).toBe(true);
});

it("reruns a closure whose loaded package names a run-unique variable or cannot be scanned", () => {
  const store = "node_modules/.pnpm/@scope+ci@1.0.0/node_modules/@scope/ci";
  shadow.write(`${store}/index.js`, "module.exports = process.env.GITHUB_SHA;\n");
  shadow.write(
    "node_modules/.pnpm/plain@2.0.0/node_modules/plain/index.js",
    "module.exports = 1;\n",
  );
  const withDependency = (key) =>
    shadow.predict([shadow.historyRun({ files: [shadow.record({ dependencies: [key] })] })]);
  expect(withDependency("pnpm:@scope+ci@1.0.0")).toMatchObject({
    reason: "run_environment_read",
    detail: "pnpm:@scope+ci@1.0.0",
  });
  expect(withDependency("pnpm:plain@2.0.0").reuse).toBe(true);
  expect(withDependency("pnpm:missing@1.0.0")).toMatchObject({ reason: "run_environment_read" });
});

it("never trusts a missing index entry, an unknown digest or an unlisted directory", () => {
  const unreadable = shadow.historyRun({ files: [closure()] });
  unreadable.index.inputs.set("packages/core/src/index.ts", { kind: "unknown", reason: "x" });
  expect(shadow.predict([unreadable])).toMatchObject({
    reason: "input_unverifiable",
    detail: "packages/core/src/index.ts",
  });
  const partial = shadow.historyRun({ files: [closure()] });
  partial.index.inputs.delete("packages/core/src/index.ts");
  expect(shadow.predict([partial])).toMatchObject({
    reason: "input_digests_unavailable",
    detail: "packages/core/src/index.ts",
  });
  const listed = shadow.historyRun({
    files: [shadow.record({ listings: [["packages/core/test/fixtures", "plain", ["unlisted"]]] })],
  });
  expect(shadow.predict([listed])).toMatchObject({ reason: "input_unverifiable" });
  const unkinded = shadow.historyRun({
    files: [
      shadow.record({ listings: [["packages/core/test/fixtures", undefined, ["sha256:x"]]] }),
    ],
  });
  expect(shadow.predict([unkinded])).toMatchObject({ reason: "input_unverifiable" });
});

it("checks the test file and the package scopes of every input", () => {
  const history = [shadow.historyRun({ files: [closure()] })];
  shadow.write("packages/core/src/package.json", '{"type":"commonjs"}\n');
  expect(shadow.predict(history)).toMatchObject({
    reason: "input_changed",
    detail: "packages/core/src/package.json",
  });
  shadow.remove();
  shadow = createShadowHarness();
  const again = [shadow.historyRun()];
  shadow.write(testFile, "changed\n");
  expect(shadow.predict(again)).toMatchObject({ reason: "input_changed", detail: testFile });
});

it("names every reason from its closed list", () => {
  expect(new Set(CI_TEST_RERUN_REASONS).size).toBe(CI_TEST_RERUN_REASONS.length);
  for (const reason of [
    "history_incomplete",
    "uncacheable_shard_written_input",
    "uncacheable_unobserved_input",
    "run_environment_read",
    "resolution_changed",
  ])
    expect(CI_TEST_RERUN_REASONS).toContain(reason);
});
