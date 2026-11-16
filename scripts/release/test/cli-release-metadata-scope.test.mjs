import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { cliReleaseMetadataScope } from "../lib/cli-release-metadata-scope.mjs";

const roots = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function repository(version) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-release-metadata-scope-"));
  roots.push(root);
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "--quiet");
  git("config", "user.name", "Release Fixture");
  git("config", "user.email", "release@lervo.invalid");
  await mkdir(resolve(root, "apps/cli"), { recursive: true });
  await writeFile(resolve(root, "apps/cli/package.json"), JSON.stringify({ version }));
  git("add", "-A");
  git("commit", "--quiet", "-m", "fixture: cli");
  return { root, git };
}

it("checks exactly until the working tree's CLI version is tagged", async () => {
  const { root, git } = await repository("0.1.0");
  expect(await cliReleaseMetadataScope(root)).toEqual({ scope: "exact", version: "0.1.0" });
  git("tag", "-a", "v0.1.0", "-m", "Release @lervo/cli v0.1.0");
  expect(await cliReleaseMetadataScope(root)).toEqual({ scope: "released", version: "0.1.0" });
  // A prepared but untagged version in the working tree is a release candidate again.
  await writeFile(resolve(root, "apps/cli/package.json"), JSON.stringify({ version: "0.1.1" }));
  expect(await cliReleaseMetadataScope(root)).toEqual({ scope: "exact", version: "0.1.1" });
});

it("checks exactly when the version cannot be read", async () => {
  const { root, git } = await repository("next");
  git("tag", "vnext");
  expect(await cliReleaseMetadataScope(root)).toEqual({ scope: "exact", version: null });
  await rm(resolve(root, "apps/cli/package.json"));
  expect(await cliReleaseMetadataScope(root)).toEqual({ scope: "exact", version: null });
});
