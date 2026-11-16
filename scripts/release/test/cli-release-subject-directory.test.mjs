import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, it } from "vitest";

import { createNpmTarball } from "./fixtures/npm-tarball.mjs";
import {
  bindSubjectDirectory,
  verifySubjectDirectory,
} from "../lib/cli-release-subject-directory.mjs";

const version = "1.2.3";
const tree = "a".repeat(40);
const revision = "b".repeat(40);
const digest = (contents) => `sha256:${createHash("sha256").update(contents).digest("hex")}`;
const bin = Buffer.from("console.log('lervo');\n");
const packageManifest = { name: "@lervo/cli", version };
const manifest = Buffer.from(
  `${JSON.stringify({
    artifact: { name: "@lervo/cli", version },
    archive: {
      rootFiles: ["package.json"],
      files: [{ path: "dist/bin.js", size: bin.length, sha256: digest(bin) }],
    },
  })}\n`,
);
const sbom = Buffer.from('{"bomFormat":"CycloneDX"}\n');
const repository = { manifest, sbom, packageManifest };
const roots = [];

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function preparedDirectory() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-release-subjects-"));
  roots.push(root);
  const directory = resolve(root, "subjects");
  await mkdir(directory);
  await writeFile(
    resolve(directory, `lervo-cli-${version}.tgz`),
    createNpmTarball([
      { path: "package/package.json", contents: Buffer.from(JSON.stringify(packageManifest)) },
      { path: "package/dist/bin.js", contents: bin },
    ]),
  );
  await writeFile(resolve(directory, "release-artifact-manifest.json"), manifest);
  await writeFile(resolve(directory, "release-sbom.cdx.json"), sbom);
  return directory;
}

const confirm = (directory) =>
  verifySubjectDirectory({ directory, expectedTag: `v${version}`, tree, repository });

async function rejects(promise, code) {
  await assert.rejects(promise, (error) => error.code === code);
}

describe("CLI release subject directory", () => {
  it("binds once and confirms the untouched subjects after the smokes", async () => {
    const directory = await preparedDirectory();
    const binding = await bindSubjectDirectory({ directory, version, revision, tree });
    assert.deepEqual(
      JSON.parse(await readFile(resolve(directory, "release-subjects.json"), "utf8")),
      binding,
    );
    assert.deepEqual(await confirm(directory), binding);
    await rejects(
      bindSubjectDirectory({ directory, version, revision, tree }),
      "release_subjects_file_set_mismatch",
    );
  });

  it("refuses subjects changed, added, or unbound after binding", async () => {
    const changed = await preparedDirectory();
    await bindSubjectDirectory({ directory: changed, version, revision, tree });
    await writeFile(resolve(changed, "release-sbom.cdx.json"), "{}\n");
    await rejects(confirm(changed), "release_subjects_digest_mismatch");

    const added = await preparedDirectory();
    await bindSubjectDirectory({ directory: added, version, revision, tree });
    await writeFile(resolve(added, ".npmrc"), "registry=x\n");
    await rejects(confirm(added), "release_subjects_file_set_mismatch");

    const nested = await preparedDirectory();
    await bindSubjectDirectory({ directory: nested, version, revision, tree });
    await mkdir(resolve(nested, "node_modules"));
    await rejects(confirm(nested), "release_subjects_file_set_mismatch");

    await rejects(confirm(await preparedDirectory()), "release_subjects_binding_invalid");
  });
});
