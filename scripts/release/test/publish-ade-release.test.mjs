import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, it } from "vitest";

const scriptPath = resolve(import.meta.dirname, "../lib/publish-ade-release.sh");
const roots = [];

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

const fakeGh = `#!/bin/bash
printf '%s\\n' "$*" >>"$FAKE_TRACE"
case "$1 $2" in
  'release view') [ "$FAKE_RELEASE_EXISTS" = 1 ] || exit 1 ;;
  'release create'|'release edit') ;;
  *) exit 2 ;;
esac
`;

const notes = (version) =>
  `<!-- lervo-release package="@lervo/ade" version="${version}" schema="1" -->\n\nNeeds the Lervo CLI 0.43.0 or later.\n`;

async function publish({ tag = "ade-v0.2.1", version = "0.2.1", exists = false } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-publish-ade-"));
  roots.push(root);
  await mkdir(resolve(root, "bin"));
  await writeFile(resolve(root, "bin/gh"), fakeGh);
  await chmod(resolve(root, "bin/gh"), 0o755);
  await writeFile(resolve(root, "notes.md"), notes(version));
  const trace = resolve(root, "trace.log");
  await writeFile(trace, "");
  const result = spawnSync("bash", [scriptPath, tag, "notes.md"], {
    cwd: root,
    encoding: "utf8",
    timeout: 20_000,
    env: {
      ...process.env,
      PATH: `${resolve(root, "bin")}:${process.env.PATH}`,
      FAKE_TRACE: trace,
      FAKE_RELEASE_EXISTS: exists ? "1" : "0",
    },
  });
  return { result, calls: (await readFile(trace, "utf8")).split("\n").filter(Boolean) };
}

describe("publish-ade-release.sh", () => {
  it("creates the release from the tag's notes, never as Latest and without files", async () => {
    const { result, calls } = await publish();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(calls, [
      "release view ade-v0.2.1",
      "release create ade-v0.2.1 --verify-tag --title @lervo/ade v0.2.1 --notes-file notes.md --latest=false",
    ]);
  });

  it("updates an existing release in place on replay, still not Latest", async () => {
    const { result, calls } = await publish({ exists: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      calls.at(-1),
      "release edit ade-v0.2.1 --title @lervo/ade v0.2.1 --notes-file notes.md --latest=false",
    );
  });

  it("refuses a CLI tag and notes of another version before calling gh", async () => {
    const cli = await publish({ tag: "v0.2.1" });
    assert.notEqual(cli.result.status, 0);
    assert.match(cli.result.stderr, /ade_release_tag_invalid/u);
    assert.deepEqual(cli.calls, []);
    const other = await publish({ version: "0.2.0" });
    assert.notEqual(other.result.status, 0);
    assert.match(other.result.stderr, /ade_release_notes_version_mismatch/u);
    assert.deepEqual(other.calls, []);
  });
});
