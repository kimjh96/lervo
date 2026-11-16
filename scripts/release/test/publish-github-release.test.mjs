import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, it } from "vitest";

const scriptPath = resolve(import.meta.dirname, "../lib/publish-github-release.sh");
const subjectNames = [
  "lervo-cli-1.2.3.tgz",
  "release-artifact-manifest.json",
  "release-sbom.cdx.json",
  "release-subjects.json",
];
const roots = [];

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

// gh evaluates --jq itself, so `release view --json` answers with the filtered asset names.
const fakeGh = `#!/bin/bash
printf '%s\\n' "$*" >>"$FAKE_TRACE"
case "$1 $2" in
  'release view')
    [ "$FAKE_RELEASE_EXISTS" = 1 ] || exit 1
    case "$*" in *--json*) printf '%s' "$FAKE_ASSETS" ;; esac ;;
  'release create'|'release edit'|'release upload') ;;
  'release download') cp "$FAKE_PUBLISHED/$5" "$7/$5" ;;
  *) exit 2 ;;
esac
`;

async function publish({ exists = false, published = {} } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-publish-release-"));
  roots.push(root);
  const subjects = resolve(root, "subjects");
  const publishedDirectory = resolve(root, "published");
  await Promise.all([mkdir(subjects), mkdir(publishedDirectory), mkdir(resolve(root, "bin"))]);
  for (const name of subjectNames) await writeFile(resolve(subjects, name), `${name}\n`);
  for (const [name, contents] of Object.entries(published))
    await writeFile(resolve(publishedDirectory, name), contents);
  await writeFile(resolve(root, "bin/gh"), fakeGh);
  await chmod(resolve(root, "bin/gh"), 0o755);
  const trace = resolve(root, "trace.log");
  await writeFile(trace, "");
  const result = spawnSync("bash", [scriptPath, "v1.2.3", subjects], {
    cwd: root,
    encoding: "utf8",
    timeout: 20_000,
    env: {
      ...process.env,
      PATH: `${resolve(root, "bin")}:${process.env.PATH}`,
      FAKE_TRACE: trace,
      FAKE_RELEASE_EXISTS: exists ? "1" : "0",
      FAKE_ASSETS: Object.keys(published)
        .map((name) => `${name}\n`)
        .join(""),
      FAKE_PUBLISHED: publishedDirectory,
    },
  });
  return { ...result, subjects, trace: await readFile(trace, "utf8") };
}

describe("GitHub release publication", () => {
  it("creates a new release with every verified subject at once", async () => {
    const result = await publish();
    assert.equal(result.status, 0, result.stderr);
    const create = result.trace.split("\n").find((line) => line.startsWith("release create"));
    assert.equal(
      create,
      `release create v1.2.3 --verify-tag --title @lervo/cli v1.2.3 --notes-file .changes/current-release.md ${subjectNames
        .map((name) => `${result.subjects}/${name}`)
        .join(" ")}`,
    );
    assert.doesNotMatch(result.trace, /release (edit|upload)/u);
  });

  it("reconciles a replay by keeping identical assets and uploading only missing ones", async () => {
    const result = await publish({
      exists: true,
      published: { "lervo-cli-1.2.3.tgz": "lervo-cli-1.2.3.tgz\n" },
    });
    assert.equal(result.status, 0, result.stderr);
    const effects = result.trace.split("\n").filter((line) => /^release (upload|edit)/u.test(line));
    assert.deepEqual(effects, [
      ...subjectNames.slice(1).map((name) => `release upload v1.2.3 ${result.subjects}/${name}`),
      "release edit v1.2.3 --title @lervo/cli v1.2.3 --notes-file .changes/current-release.md --draft=false",
    ]);
    assert.doesNotMatch(result.trace, /release create/u);
  });

  it("never replaces a published asset with different bytes or keeps an unknown one", async () => {
    const conflict = await publish({
      exists: true,
      published: { "lervo-cli-1.2.3.tgz": "other bytes\n" },
    });
    assert.equal(conflict.status, 1);
    assert.match(conflict.stderr, /release_asset_conflict/u);
    const unexpected = await publish({ exists: true, published: { "notes.txt": "x\n" } });
    assert.equal(unexpected.status, 1);
    assert.match(unexpected.stderr, /release_asset_unexpected/u);
    for (const result of [conflict, unexpected])
      assert.doesNotMatch(result.trace, /release (upload|edit)/u);
  });
});
