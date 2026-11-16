import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, it } from "vitest";

const waitScript = resolve(
  import.meta.dirname,
  "../../../.agents/skills/deploy-lervo-release/scripts/wait-release.sh",
);
const head = "b".repeat(40);
const roots = [];

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

// gh evaluates --jq itself, so this fake answers with the filtered text the script reads.
const fakeGh = `#!/bin/bash
printf '%s\\n' "$*" >>"$FAKE_TRACE"
case "$1 $2" in
  'run list')
    case "$*" in
      *release-pull-request.yml*) echo "$FAKE_PREPARATION" ;;
      *code-quality.yml*) echo "$FAKE_DISPATCH" ;;
      *cli-release-matrix.yml*) echo "$FAKE_MATRIX" ;;
      *"CLI release matrix"*) echo "$FAKE_TAG_MATRIX" ;;
    esac ;;
  'release view') echo "$FAKE_RELEASE" ;;
  'run view') echo "$FAKE_AGGREGATE" ;;
  'pr view')
    case "$*" in
      *baseRefName*) echo main ;;
      *)
        # FAKE_MOVED_HEAD replaces the head after the first read, as a concurrent push would.
        reads=$(( $(cat "$FAKE_TRACE.reads" 2>/dev/null || echo 0) + 1 ))
        echo "$reads" >"$FAKE_TRACE.reads"
        if [ -n "\${FAKE_MOVED_HEAD:-}" ] && [ "$reads" -gt 1 ]; then echo "$FAKE_MOVED_HEAD"; else echo "$FAKE_HEAD"; fi ;;
    esac ;;
  'pr checks') echo "$FAKE_CHECKS"; exit "\${FAKE_CHECKS_STATUS:-0}" ;;
  api\\ *compare*) echo "$FAKE_COMPARE" ;;
  api\\ *commits*) echo "$FAKE_AUTHOR" ;;
  *) exit 2 ;;
esac
`;

// A concluding wait exits at once, so the default deadline only bounds a broken run. Cases that
// expect a timeout pass "0", which judges the head exactly once and never depends on the clock.
// The tag stage asks git whether the tag exists on origin; this fake always finds it.
const fakeGit = `#!/bin/bash
[ "$1" = ls-remote ] && exit 0
exit 2
`;

async function wait(state, timeoutSeconds = "10", stage = ["pr", "7"]) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-wait-release-"));
  roots.push(root);
  await writeFile(resolve(root, "gh"), fakeGh);
  await writeFile(resolve(root, "git"), fakeGit);
  await chmod(resolve(root, "gh"), 0o755);
  await chmod(resolve(root, "git"), 0o755);
  const trace = resolve(root, "trace.log");
  await writeFile(trace, "");
  const result = spawnSync("bash", [waitScript, ...stage, timeoutSeconds], {
    cwd: root,
    encoding: "utf8",
    timeout: 20_000,
    env: {
      ...process.env,
      PATH: `${root}:${process.env.PATH}`,
      WAIT_RELEASE_POLL_SECONDS: "0.2",
      FAKE_TRACE: trace,
      FAKE_HEAD: head,
      FAKE_PREPARATION: "completed/success",
      FAKE_COMPARE: "ahead",
      FAKE_AUTHOR: "lervo-release[bot]|chore(cli): prepare release",
      FAKE_DISPATCH: "none",
      FAKE_MATRIX: "21 completed success",
      FAKE_AGGREGATE: "1",
      FAKE_CHECKS: "2 0 0 Conventional Commits=pass",
      ...state,
    },
  });
  return { status: result.status, stdout: result.stdout, trace: await readFile(trace, "utf8") };
}

describe("deploy-lervo-release pull-request wait", () => {
  it("passes a prepared head only on its own successful dispatched verification", async () => {
    const passed = await wait({ FAKE_DISPATCH: "11 completed success" });
    assert.equal(passed.status, 0, passed.stdout);
    assert.match(passed.stdout, /Code quality run 11 for b{40}: completed\/success/u);
    assert.match(
      passed.trace,
      new RegExp(`code-quality\\.yml --commit ${head} --event workflow_dispatch`, "u"),
    );
    assert.doesNotMatch(passed.trace, /pr checks/u);

    for (const state of [
      { FAKE_DISPATCH: "11 completed failure" },
      { FAKE_DISPATCH: "11 completed success", FAKE_AGGREGATE: "0" },
    ])
      assert.equal((await wait(state)).status, 1);
  });

  it("keeps waiting while a prepared head has no dispatch or an unfinished one", async () => {
    const missing = await wait({}, "0");
    assert.equal(missing.status, 2);
    assert.match(missing.stdout, /waiting for its dispatched Code quality run/u);
    assert.doesNotMatch(missing.trace, /pr checks/u);
    assert.equal((await wait({ FAKE_DISPATCH: "11 in_progress " }, "0")).status, 2);
  });

  it("judges the head once before reporting a deadline that already passed", async () => {
    const expired = await wait({}, "0");
    assert.equal(expired.status, 2);
    assert.match(expired.stdout, /^TIMEOUT pr 7: prepared head b{40}: waiting for its dispatched/u);
    assert.equal((await wait({ FAKE_DISPATCH: "11 completed success" }, "0")).status, 0);
  });

  it("uses pull-request checks for an unprepared head without a dispatch", async () => {
    const author = { FAKE_AUTHOR: "Owner|feat: add capability" };
    assert.equal((await wait(author)).status, 0);
    const failed = await wait({
      ...author,
      FAKE_CHECKS: "2 0 1 Tests=fail",
      FAKE_CHECKS_STATUS: "1",
    });
    assert.equal(failed.status, 1);
    assert.equal((await wait({ ...author, FAKE_CHECKS: "2 1 0 Tests=pending" }, "0")).status, 2);
  });

  it("judges the head again when it moves during the checks and binds the merge to it", async () => {
    const moved = "c".repeat(40);
    const result = await wait({ FAKE_DISPATCH: "11 completed success", FAKE_MOVED_HEAD: moved });
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, new RegExp(`passed at ${moved}`, "u"));
    assert.match(result.stdout, new RegExp(`--match-head-commit ${moved}`, "u"));
    assert.match(result.trace, new RegExp(`compare/main\\.\\.\\.${moved}`, "u"));
    assert.doesNotMatch(result.stdout, new RegExp(`passed at ${head}`, "u"));
  });

  it("reports stale heads and preparation results before any verification", async () => {
    const stale = await wait({ FAKE_COMPARE: "behind", FAKE_DISPATCH: "11 completed success" });
    assert.equal(stale.status, 3);
    assert.match(stale.stdout, /gh pr update-branch 7/u);
    assert.equal((await wait({ FAKE_PREPARATION: "completed/failure" })).status, 1);
    const running = await wait(
      { FAKE_PREPARATION: "in_progress/", FAKE_DISPATCH: "11 completed success" },
      "0",
    );
    assert.equal(running.status, 2);
    assert.match(running.stdout, /release preparation in_progress/u);
  });

  it("requires a prepared head's own dispatched release matrix before it passes", async () => {
    const passed = await wait({ FAKE_DISPATCH: "11 completed success" });
    assert.equal(passed.status, 0, passed.stdout);
    assert.match(passed.stdout, /CLI release matrix run 21: completed\/success/u);
    assert.match(
      passed.trace,
      new RegExp(`cli-release-matrix\\.yml --commit ${head} --event workflow_dispatch`, "u"),
    );
    const failed = await wait({
      FAKE_DISPATCH: "11 in_progress ",
      FAKE_MATRIX: "21 completed failure",
    });
    assert.equal(failed.status, 1, failed.stdout);
    assert.match(failed.stdout, /CLI release matrix run 21: completed\/failure/u);
    for (const matrix of ["none", "21 in_progress "]) {
      const pending = await wait(
        { FAKE_DISPATCH: "11 completed success", FAKE_MATRIX: matrix },
        "0",
      );
      assert.equal(pending.status, 2, pending.stdout);
    }
    const missing = await wait({ FAKE_DISPATCH: "11 completed success", FAKE_MATRIX: "none" }, "0");
    assert.match(missing.stdout, /waiting for its dispatched CLI release matrix run/u);
    assert.match(
      missing.stdout,
      /rerun release preparation \(gh workflow run release-pull-request\.yml -f pull_request=7\)/u,
    );
  });

  it("does not require a release matrix for an unprepared head", async () => {
    const result = await wait({
      FAKE_AUTHOR: "Owner|feat: add capability",
      FAKE_DISPATCH: "11 completed success",
      FAKE_MATRIX: "none",
    });
    assert.equal(result.status, 0, result.stdout);
    assert.doesNotMatch(result.trace, /cli-release-matrix\.yml/u);
  });
});

describe("deploy-lervo-release tag wait", () => {
  const subjects =
    "lervo-cli-1.2.3.tgz,release-artifact-manifest.json,release-sbom.cdx.json,release-subjects.json";

  it("passes only once the published release carries every verified subject", async () => {
    const tag = (state, timeout = "10") =>
      wait({ FAKE_TAG_MATRIX: "completed/success", ...state }, timeout, ["tag", "1.2.3"]);
    const released = await tag({ FAKE_RELEASE: `false ${subjects}` });
    assert.equal(released.status, 0, released.stdout);
    assert.match(released.stdout, /release published with verified subjects/u);
    for (const release of [
      "false lervo-cli-1.2.3.tgz",
      `true ${subjects}`,
      "false lervo-cli-1.2.4.tgz,release-artifact-manifest.json,release-sbom.cdx.json,release-subjects.json",
    ]) {
      const waiting = await tag({ FAKE_RELEASE: release }, "0");
      assert.equal(waiting.status, 2, waiting.stdout);
    }
    const failed = await tag({ FAKE_TAG_MATRIX: "completed/failure" });
    assert.equal(failed.status, 1, failed.stdout);
  });
});
