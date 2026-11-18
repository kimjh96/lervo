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

// gh evaluates --jq itself, so this fake answers with the filtered text the script reads. The first
// FAKE_GH_FAILURES calls fail as an unreachable API would.
const fakeGh = `#!/bin/bash
printf '%s\\n' "$*" >>"$FAKE_TRACE"
failed=$(cat "$FAKE_TRACE.failed" 2>/dev/null || echo 0)
if [ "$failed" -lt "\${FAKE_GH_FAILURES:-0}" ]; then
  echo $((failed + 1)) >"$FAKE_TRACE.failed"
  echo 'error connecting to api.github.com' >&2
  echo 'check your internet connection or https://githubstatus.com' >&2
  exit 1
fi
case "$1 $2" in
  'run list')
    case "$*" in
      *release-pull-request.yml*) echo "$FAKE_PREPARATION" ;;
      *code-quality.yml*) echo "$FAKE_DISPATCH" ;;
      *cli-release-matrix.yml*) echo "$FAKE_MATRIX" ;;
      # A rerun replaces the matrix state the next poll reads.
      *"CLI release matrix"*) cat "$FAKE_TRACE.rerun" 2>/dev/null || echo "$FAKE_TAG_MATRIX" ;;
      *"CLI release preparation"*) echo "$FAKE_RELEASE_PREPARATION" ;;
      *name,status,conclusion,createdAt*) echo "$FAKE_CANDIDATE" ;;
    esac ;;
  'pr list') echo "$FAKE_RELEASE_PR" ;;
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
  'run rerun') echo "$FAKE_TAG_MATRIX_AFTER_RERUN" >"$FAKE_TRACE.rerun" ;;
  api\\ *compare*) echo "$FAKE_COMPARE" ;;
  api\\ */jobs*)
    [ -n "\${FAKE_JOBS_STATUS:-}" ] && { echo 'HTTP 502: Bad Gateway' >&2; exit "$FAKE_JOBS_STATUS"; }
    echo "$FAKE_JOBS" ;;
  api\\ *commits*) echo "$FAKE_AUTHOR" ;;
  api\\ *contents/apps/cli/package.json*) echo "\${FAKE_MAIN_VERSION:-1.2.3}" ;;
  *) exit 2 ;;
esac
`;

// A concluding wait exits at once, so the default deadline only bounds a broken run. Cases that
// expect a timeout pass "0", which judges the head exactly once and never depends on the clock.
// The tag stage asks git whether the tag exists on origin; this fake finds it unless
// FAKE_GIT_STATUS names another ls-remote exit status.
const fakeGit = `#!/bin/bash
if [ "$1" = ls-remote ]; then
  [ -n "\${FAKE_GIT_STATUS:-}" ] || exit 0
  echo 'fatal: unable to access origin' >&2
  exit "$FAKE_GIT_STATUS"
fi
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
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    trace: await readFile(trace, "utf8"),
  };
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

  it("holds a passed unprepared head until main's release version is tagged", async () => {
    const author = { FAKE_AUTHOR: "Owner|feat: add capability" };
    for (const state of [author, { ...author, FAKE_DISPATCH: "11 completed success" }]) {
      const waiting = await wait({ ...state, FAKE_GIT_STATUS: "2" }, "0");
      assert.equal(waiting.status, 2, waiting.stdout);
      assert.match(waiting.stdout, /waiting for v1\.2\.3, the release on main, before a merge/u);
      assert.match(waiting.trace, /contents\/apps\/cli\/package\.json\?ref=main/u);
    }
    const unknown = await wait({ ...author, FAKE_GIT_STATUS: "128" }, "0");
    assert.equal(unknown.status, 2, unknown.stdout);
    assert.match(unknown.stdout, /last query failure: git_unavailable: fatal: unable to access/u);
    assert.equal((await wait({ ...author, FAKE_MAIN_VERSION: "next" }, "0")).status, 2);
    // A prepared head carries the release itself, so it never waits for main's tag.
    const prepared = await wait({ FAKE_DISPATCH: "11 completed success", FAKE_GIT_STATUS: "2" });
    assert.equal(prepared.status, 0, prepared.stdout);
    assert.doesNotMatch(prepared.trace, /contents\/apps/u);
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

  it("reruns a matrix only when its cancelled jobs never got a runner", async () => {
    const tag = (state) =>
      wait(
        {
          FAKE_TAG_MATRIX: "completed/cancelled 31",
          FAKE_TAG_MATRIX_AFTER_RERUN: "completed/success 31",
          FAKE_RELEASE: `false ${subjects}`,
          ...state,
        },
        "10",
        ["tag", "1.2.3"],
      );
    const rerun = await tag({ FAKE_JOBS: "2 2" });
    assert.equal(rerun.status, 0, rerun.stdout);
    assert.match(rerun.trace, /run rerun 31 --failed/u);
    assert.match(rerun.trace, /actions\/runs\/31\/jobs/u);
    for (const jobs of ["2 1", "0 0", ""]) {
      const failed = await tag({ FAKE_JOBS: jobs });
      assert.equal(failed.status, 1, failed.stdout);
      assert.match(failed.stdout, /matrix failed: completed\/cancelled/u);
      assert.doesNotMatch(failed.trace, /run rerun/u);
    }
    const bounded = await tag({
      FAKE_JOBS: "1 1",
      FAKE_TAG_MATRIX_AFTER_RERUN: "completed/cancelled 31",
      WAIT_RELEASE_RERUNS: "2",
    });
    assert.equal(bounded.status, 1, bounded.stdout);
    assert.equal(bounded.trace.match(/run rerun 31/gu).length, 2);
  });
});

describe("deploy-lervo-release wait with an unavailable GitHub", () => {
  const unavailable = "gh_unavailable: error connecting to api.github.com";
  const subjects =
    "lervo-cli-1.2.3.tgz,release-artifact-manifest.json,release-sbom.cdx.json,release-subjects.json";
  const stages = {
    pr: [{ FAKE_DISPATCH: "11 completed success" }, ["pr", "7"]],
    "release-pr": [
      {
        FAKE_RELEASE_PR: "41",
        FAKE_CANDIDATE:
          "2 0 0 Code quality=completed/success, CLI release matrix=completed/success",
      },
      ["release-pr"],
    ],
    tag: [
      { FAKE_TAG_MATRIX: "completed/success 31", FAKE_RELEASE: `false ${subjects}` },
      ["tag", "1.2.3"],
    ],
  };

  it("retries every stage through failing gh calls and says why", async () => {
    for (const [name, [state, stage]] of Object.entries(stages)) {
      const result = await wait({ ...state, FAKE_GH_FAILURES: "3" }, "10", stage);
      assert.equal(result.status, 0, `${name}: ${result.stdout}${result.stderr}`);
      assert.match(result.stdout, /passed|released/u);
      assert.ok(result.stderr.includes(`${unavailable} (2 rounds in a row`), result.stderr);
      // Backoff doubles the pause after each failed round.
      assert.ok(result.stderr.includes("(3 rounds in a row; next poll in 4x0.2s)"), result.stderr);
    }
  });

  it("names the last failure when a stage times out and keeps the timeout exit", async () => {
    for (const [name, [state, stage]] of Object.entries(stages)) {
      const result = await wait({ ...state, FAKE_GH_FAILURES: "1000" }, "0", stage);
      assert.equal(result.status, 2, `${name}: ${result.stdout}`);
      assert.match(result.stdout, /^TIMEOUT /u);
      assert.ok(result.stdout.trimEnd().endsWith(`; last query failure: ${unavailable}`), name);
    }
    const origin = await wait({ FAKE_GIT_STATUS: "128" }, "0", ["tag", "1.2.3"]);
    assert.equal(origin.status, 2, origin.stdout);
    assert.match(
      origin.stdout,
      /v1\.2\.3 on origin unknown; last query failure: git_unavailable: fatal: unable to access origin/u,
    );
  });

  it("reads an empty answer as empty, not as unavailable", async () => {
    const none = await wait(
      { FAKE_RELEASE_PR: "", FAKE_RELEASE_PREPARATION: "in_progress/" },
      "0",
      ["release-pr"],
    );
    assert.equal(none.status, 2, none.stdout);
    assert.match(none.stdout, /no release PR yet; preparation in_progress\//u);
    const untagged = await wait({ FAKE_GIT_STATUS: "2" }, "0", ["tag", "1.2.3"]);
    assert.equal(untagged.status, 2, untagged.stdout);
    assert.match(untagged.stdout, /v1\.2\.3 not pushed yet/u);
    for (const result of [none, untagged])
      assert.doesNotMatch(result.stdout + result.stderr, /unavailable|query failure/u);
  });

  it("does not fail a cancelled matrix whose jobs could not be read", async () => {
    const result = await wait(
      { FAKE_TAG_MATRIX: "completed/cancelled 31", FAKE_JOBS_STATUS: "1" },
      "0",
      ["tag", "1.2.3"],
    );
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stdout, /cancelled; its jobs could not be read/u);
    assert.match(result.stdout, /gh_unavailable: HTTP 502: Bad Gateway/u);
    assert.doesNotMatch(result.trace, /run rerun/u);
  });
});
