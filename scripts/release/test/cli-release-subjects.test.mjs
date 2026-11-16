import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, it } from "vitest";

import { createNpmTarball } from "./fixtures/npm-tarball.mjs";
import {
  createReleaseSubjectsBinding,
  releaseSubjectNames,
  verifyReleaseSubjects,
} from "../lib/cli-release-subjects.mjs";
import { readNpmTarballEntries } from "../lib/npm-tarball-entries.mjs";

const version = "1.2.3";
const tree = "a".repeat(40);
const revision = "b".repeat(40);
const tarballName = `lervo-cli-${version}.tgz`;
const digest = (contents) => `sha256:${createHash("sha256").update(contents).digest("hex")}`;
const roots = [];

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

const packageFiles = {
  "README.md": Buffer.from("readme\n"),
  "dist/bin.js": Buffer.from("console.log('lervo');\n"),
};

function manifestFor(files = packageFiles) {
  return Buffer.from(
    `${JSON.stringify({
      schemaVersion: 10,
      artifact: { name: "@lervo/cli", version },
      archive: {
        rootFiles: ["package.json"],
        files: Object.entries(files).map(([path, contents]) => ({
          path,
          size: contents.length,
          sha256: digest(contents),
        })),
      },
    })}\n`,
  );
}

function tarballFor(files = packageFiles, packageManifest = { name: "@lervo/cli", version }) {
  return createNpmTarball([
    { path: "package/package.json", contents: Buffer.from(JSON.stringify(packageManifest)) },
    ...Object.entries(files).map(([path, contents]) => ({ path: `package/${path}`, contents })),
  ]);
}

function release({ tarball = tarballFor(), manifest = manifestFor(), sbom } = {}) {
  const files = new Map([
    [tarballName, tarball],
    ["release-artifact-manifest.json", manifest],
    ["release-sbom.cdx.json", sbom ?? Buffer.from('{"bomFormat":"CycloneDX"}\n')],
  ]);
  const binding = createReleaseSubjectsBinding({ version, revision, tree, files });
  return {
    files,
    binding,
    input: {
      expectedTag: `v${version}`,
      tree,
      bindingContents: Buffer.from(JSON.stringify(binding)),
      files,
      repository: {
        manifest: files.get("release-artifact-manifest.json"),
        sbom: files.get("release-sbom.cdx.json"),
        packageManifest: { name: "@lervo/cli", version },
      },
    },
  };
}

function rejects(input, code) {
  assert.throws(
    () => verifyReleaseSubjects(input),
    (error) => error.code === code,
  );
}

describe("CLI release subjects", () => {
  it("binds exactly the tarball, manifest, and SBOM to one tree", () => {
    const { binding } = release();
    assert.deepEqual(releaseSubjectNames(version), [
      tarballName,
      "release-artifact-manifest.json",
      "release-sbom.cdx.json",
    ]);
    assert.equal(binding.tag, "v1.2.3");
    assert.equal(binding.tree, tree);
    assert.equal(binding.revision, revision);
    assert.deepEqual(
      binding.files.map(({ name }) => name),
      releaseSubjectNames(version),
    );
    const files = new Map(release().files);
    files.set("extra.txt", Buffer.from("x"));
    assert.throws(
      () => createReleaseSubjectsBinding({ version, revision, tree, files }),
      (error) => error.code === "release_subjects_file_set_mismatch",
    );
    assert.throws(
      () => createReleaseSubjectsBinding({ version, revision: "HEAD", tree, files }),
      (error) => error.code === "release_subjects_input_invalid",
    );
  });

  it("accepts the exact bound bytes for the released tree and tag", () => {
    const { input, binding } = release();
    assert.deepEqual(verifyReleaseSubjects(input), binding);
  });

  it("fails closed when the tag, tree, or file set differs", () => {
    const { input } = release();
    rejects({ ...input, expectedTag: "v1.2.4" }, "release_subjects_tag_mismatch");
    rejects({ ...input, tree: "c".repeat(40) }, "release_subjects_tree_mismatch");
    const extra = new Map(input.files).set("notes.txt", Buffer.from("x"));
    rejects({ ...input, files: extra }, "release_subjects_file_set_mismatch");
    const missing = new Map(input.files);
    missing.delete("release-sbom.cdx.json");
    rejects({ ...input, files: missing }, "release_subjects_file_set_mismatch");
    rejects({ ...input, bindingContents: Buffer.from("{") }, "release_subjects_binding_invalid");
    rejects({ ...input, bindingContents: Buffer.alloc(0) }, "release_subjects_binding_invalid");
  });

  it("rejects bytes that differ from the binding", () => {
    const { input } = release();
    const altered = new Map(input.files).set(tarballName, tarballFor({ ...packageFiles }, {}));
    rejects({ ...input, files: altered }, "release_subjects_digest_mismatch");
  });

  it("rejects metadata that differs from the released tree", () => {
    const { input } = release();
    rejects(
      { ...input, repository: { ...input.repository, sbom: Buffer.from("{}\n") } },
      "release_subjects_metadata_mismatch",
    );
    rejects(
      { ...input, repository: { ...input.repository, manifest: manifestFor({}) } },
      "release_subjects_metadata_mismatch",
    );
  });

  it("rejects a consistently bound tarball whose contents differ from the manifest", () => {
    const changed = { ...packageFiles, "dist/bin.js": Buffer.from("tampered\n") };
    rejects(release({ tarball: tarballFor(changed) }).input, "release_subjects_archive_mismatch");
    const extra = { ...packageFiles, "dist/extra.js": Buffer.from("extra\n") };
    rejects(release({ tarball: tarballFor(extra) }).input, "release_subjects_archive_mismatch");
    const otherVersion = tarballFor(packageFiles, { name: "@lervo/cli", version: "9.9.9" });
    rejects(release({ tarball: otherVersion }).input, "release_subjects_archive_mismatch");
    rejects(
      release({ tarball: Buffer.from("not a tarball") }).input,
      "release_subjects_archive_mismatch",
    );
  });
});

describe("CLI release tarball package manifest", () => {
  const source = {
    name: "@lervo/cli",
    version,
    bin: { lervo: "./dist/bin.js" },
    scripts: { build: "tsc" },
    dependencies: { zod: "4.4.3" },
    devDependencies: { "@lervo/core": "0.1.0", esbuild: "0.28.2" },
  };
  const withManifest = (packageManifest) => {
    const { input } = release({ tarball: tarballFor(packageFiles, packageManifest) });
    return { ...input, repository: { ...input.repository, packageManifest: source } };
  };

  it("accepts the expected fields in any key order", () => {
    const reordered = {
      devDependencies: { esbuild: "0.28.2", "@lervo/core": "0.1.0" },
      scripts: { build: "tsc" },
      version,
      name: "@lervo/cli",
      dependencies: { zod: "4.4.3" },
      bin: { lervo: "./dist/bin.js" },
    };
    assert.equal(verifyReleaseSubjects(withManifest(reordered)).tag, `v${version}`);
  });

  it("rejects changed scripts, bin, dependencies, or extra fields", () => {
    for (const change of [
      { scripts: { build: "tsc", postinstall: "node evil.js" } },
      { bin: { lervo: "./dist/other.js" } },
      { dependencies: { zod: "4.4.4" } },
      { devDependencies: { esbuild: "0.28.2" } },
      { main: "./dist/bin.js" },
    ])
      rejects(withManifest({ ...source, ...change }), "release_subjects_package_manifest_mismatch");
  });
});

describe("npm tarball entries", () => {
  it("lists regular files by package-relative path and skips directories", () => {
    const entries = readNpmTarballEntries(
      createNpmTarball([
        { path: "package/", type: "5" },
        { path: "package/dist/a.js", contents: Buffer.from("a") },
      ]),
    );
    assert.deepEqual([...entries.keys()], ["dist/a.js"]);
    assert.equal(entries.get("dist/a.js").toString(), "a");
  });

  it("rejects links, escapes, duplicates, and paths outside the package", () => {
    for (const entries of [
      [{ path: "package/link", type: "2" }],
      [{ path: "package/../escape.js" }],
      [{ path: "other/file.js" }],
      [{ path: "package/a.js" }, { path: "package/a.js" }],
    ])
      assert.throws(
        () => readNpmTarballEntries(createNpmTarball(entries)),
        (error) => error.code === "npm_tarball_invalid",
      );
  });

  it("reads a tarball that pnpm packs, including long nested paths", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-npm-tarball-"));
    roots.push(root);
    const longPath = `dist/${"nested-directory/".repeat(6)}repository-runtime-0123456789abcdef.cjs`;
    await mkdir(resolve(root, "pkg", longPath, ".."), { recursive: true });
    await writeFile(
      resolve(root, "pkg/package.json"),
      JSON.stringify({ name: "fixture-package", version: "1.0.0", files: ["dist"] }),
    );
    await writeFile(resolve(root, "pkg", longPath), "module.exports = 1;\n");
    const report = JSON.parse(
      execFileSync("pnpm", ["pack", "--pack-destination", root, "--json"], {
        cwd: resolve(root, "pkg"),
        encoding: "utf8",
      }),
    );
    const entries = readNpmTarballEntries(await readFile(report.filename));
    assert.deepEqual([...entries.keys()].sort(), [longPath, "package.json"].sort());
    assert.equal(entries.get(longPath).toString(), "module.exports = 1;\n");
  });
});
