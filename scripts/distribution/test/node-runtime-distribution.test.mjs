import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, it } from "vitest";

import {
  collectDistributionEntries,
  createNodeDistributionArtifact,
  createNodeDistributionManifest,
  validateNodeDistributionArtifact,
  validateNodeDistributionManifest,
} from "../lib/node-runtime-distribution.mjs";
import { sha256 } from "../../shared/release-artifact-manifest.mjs";
import { extractTarGzipArchive } from "../../shared/tar-archive.mjs";

const execFileAsync = promisify(execFile);

const roots = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

function manifestFixture() {
  const files = [
    { path: "dist/bin.js", kind: "file", size: 1, mode: 0o755, sha256: `sha256:${"a".repeat(64)}` },
    {
      path: "package.json",
      kind: "file",
      size: 1,
      mode: 0o644,
      sha256: `sha256:${"b".repeat(64)}`,
    },
    {
      path: "sbom.cdx.json",
      kind: "file",
      size: 1,
      mode: 0o644,
      sha256: `sha256:${"c".repeat(64)}`,
    },
  ];
  return createNodeDistributionManifest({
    runtimeVersion: "0.1.0",
    platform: { os: "linux", arch: "x64", libc: "glibc" },
    files,
    dependencies: ["@anthropic-ai/claude-agent-sdk-linux-x64@0.3.226"],
    sbomSha256: files[2].sha256,
  });
}

describe("standalone Node runtime distribution contract", () => {
  it("accepts a self-consistent provider-neutral runtime manifest", () => {
    const manifest = manifestFixture();
    assert.equal(validateNodeDistributionManifest(manifest), manifest);
    assert.equal(manifest.claims.registryRequiredAtInstall, false);
    assert.equal(manifest.claims.serviceActivated, false);
  });

  it("rejects content, platform, and stronger service claims", () => {
    const changed = manifestFixture();
    changed.files[0].size += 1;
    assert.throws(() => validateNodeDistributionManifest(changed), {
      code: "node_distribution_manifest_invalid",
    });
    const claimed = manifestFixture();
    claimed.claims.serviceActivated = true;
    assert.throws(() => validateNodeDistributionManifest(claimed), {
      code: "node_distribution_manifest_invalid",
    });
  });

  it("binds the sidecar to one archive name, platform, size, and digest", () => {
    const artifact = createNodeDistributionArtifact({
      runtimeVersion: "0.1.0",
      platform: { os: "linux", arch: "x64", libc: "glibc" },
      archiveFileName: "lervo-node-linux-x64.tar.gz",
      byteCount: 123,
      sha256: `sha256:${"d".repeat(64)}`,
      manifestSha256: `sha256:${"e".repeat(64)}`,
    });
    assert.equal(validateNodeDistributionArtifact(artifact), artifact);
    artifact.archiveFileName = "../escaped.tar.gz";
    assert.throws(() => validateNodeDistributionArtifact(artifact), {
      code: "node_distribution_artifact_invalid",
    });
  });

  it("hashes regular files and rejects symlinks escaping the distribution root", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-node-contract-"));
    roots.push(root);
    await mkdir(resolve(root, "dist"));
    await writeFile(resolve(root, "dist/bin.js"), "x");
    const info = await stat(resolve(root, "dist/bin.js"));
    assert.deepEqual(await collectDistributionEntries(root), [
      {
        path: "dist/bin.js",
        kind: "file",
        size: 1,
        mode: info.mode & 0o777,
        sha256: sha256(Buffer.from("x")),
      },
    ]);
  });

  it("rejects a symlink whose normalized target leaves the archive root", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-node-contract-"));
    roots.push(root);
    await symlink("../../outside", resolve(root, "escape"));
    await assert.rejects(() => collectDistributionEntries(root), {
      code: "node_distribution_symlink_invalid",
    });
  });

  it("restores manifest file modes independently of the installer umask", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-node-mode-"));
    roots.push(root);
    const source = resolve(root, "source");
    const destination = resolve(root, "destination");
    const archive = resolve(root, "fixture.tar.gz");
    await Promise.all([mkdir(source), mkdir(destination)]);
    const payload = resolve(source, "payload.txt");
    await writeFile(payload, "mode-bound\n");
    await chmod(payload, 0o664);
    await execFileAsync("tar", ["-czf", archive, "-C", source, "."]);

    const previousUmask = process.umask(0o077);
    try {
      await extractTarGzipArchive(archive, destination);
    } finally {
      process.umask(previousUmask);
    }

    assert.equal((await stat(resolve(destination, "payload.txt"))).mode & 0o777, 0o664);
  });
});
