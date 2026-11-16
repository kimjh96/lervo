import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import { createCiBuildTransfer, restoreCiBuildTransfer } from "../lib/ci-build-transfer.mjs";

const roots = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-ci-build-"));
  roots.push(root);
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "--quiet");
  git("config", "user.name", "CI Fixture");
  git("config", "user.email", "ci@lervo.invalid");
  await writeFile(resolve(root, "README.md"), "fixture\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "fixture: initial");
  await mkdir(resolve(root, "packages"));
  await mkdir(resolve(root, "apps/cli/dist"), { recursive: true });
  const executable = resolve(root, "apps/cli/dist/bin.js");
  await writeFile(executable, "console.log('fixture');\n");
  await chmod(executable, 0o755);
  const artifactDirectory = resolve(root, "archive");
  const input = { repositoryRoot: root, artifactDirectory };
  await createCiBuildTransfer(input);
  return { root, executable, input };
}

it("restores exact build bytes and executable modes without Git or user state", async () => {
  const f = await fixture();
  const stale = resolve(f.root, "apps/cli/dist/stale.js");
  await writeFile(stale, "stale");
  await restoreCiBuildTransfer(f.input);
  await expect(stat(stale)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(f.executable, "utf8")).toBe("console.log('fixture');\n");
  expect((await stat(f.executable)).mode & 0o777).toBe(0o755);
  const paths = execFileSync(
    "tar",
    ["-tf", resolve(f.input.artifactDirectory, "workspace-build.tar")],
    { encoding: "utf8" },
  );
  expect(paths).not.toMatch(/\.git|\.lervo|node_modules/u);
});

it.each([
  "revision",
  "nodeVersion",
  "architecture",
  "platform",
  "verificationContract",
  "workflow",
  "runId",
])("rejects mismatched %s before restoring outputs", async (field) => {
  const f = await fixture();
  const receiptPath = resolve(f.input.artifactDirectory, "receipt.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  receipt[field] = "wrong";
  await writeFile(receiptPath, JSON.stringify(receipt));
  await rm(resolve(f.root, "apps/cli/dist"), { recursive: true });
  await expect(restoreCiBuildTransfer(f.input)).rejects.toThrow("ci_build_identity_mismatch");
  await expect(stat(f.executable)).rejects.toMatchObject({ code: "ENOENT" });
});

it("accepts a successful producer from the same run when retrying failed consumers", async () => {
  vi.stubEnv("GITHUB_RUN_ATTEMPT", "1");
  const f = await fixture();
  vi.stubEnv("GITHUB_RUN_ATTEMPT", "2");
  await restoreCiBuildTransfer(f.input);
  vi.stubEnv("GITHUB_RUN_ATTEMPT", "0");
  await expect(restoreCiBuildTransfer(f.input)).rejects.toThrow("ci_build_identity_mismatch");
});

async function replaceArchive(f, paths) {
  const archive = resolve(f.input.artifactDirectory, "workspace-build.tar");
  execFileSync("tar", ["-cf", archive, "-C", f.root, ...paths]);
  const receiptPath = resolve(f.input.artifactDirectory, "receipt.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  receipt.buildDigest = `sha256:${createHash("sha256")
    .update(await readFile(archive))
    .digest("hex")}`;
  await writeFile(receiptPath, JSON.stringify(receipt));
}

it("rejects out-of-scope archive members and symbolic links before extraction", async () => {
  const f = await fixture();
  await replaceArchive(f, ["README.md"]);
  await expect(restoreCiBuildTransfer(f.input)).rejects.toThrow("ci_build_archive_path_invalid");
  await symlink("../../../README.md", resolve(f.root, "apps/cli/dist/link"));
  await replaceArchive(f, ["apps/cli/dist"]);
  await expect(restoreCiBuildTransfer(f.input)).rejects.toThrow("ci_build_archive_entry_invalid");
  expect(await readFile(f.executable, "utf8")).toBe("console.log('fixture');\n");
});

it("rejects a destination parent symlink without changing its target", async () => {
  const f = await fixture();
  const external = resolve(f.root, "external");
  await mkdir(external);
  await writeFile(resolve(external, "sentinel"), "preserve");
  await rm(resolve(f.root, "apps/cli"), { recursive: true });
  await symlink(external, resolve(f.root, "apps/cli"));
  await expect(restoreCiBuildTransfer(f.input)).rejects.toThrow("ci_build_destination_invalid");
  expect(await readFile(resolve(external, "sentinel"), "utf8")).toBe("preserve");
});

it("carries this build's release metadata so every consumer verifies the same files", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-ci-build-"));
  roots.push(root);
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "--quiet");
  git("config", "user.name", "CI Fixture");
  git("config", "user.email", "ci@lervo.invalid");
  const manifest = resolve(root, "apps/cli/release-artifact-manifest.json");
  const sbom = resolve(root, "apps/cli/release-sbom.cdx.json");
  await mkdir(resolve(root, "apps/cli/dist"), { recursive: true });
  await mkdir(resolve(root, "packages"));
  await writeFile(manifest, "committed manifest\n");
  await writeFile(sbom, "committed sbom\n");
  git("add", "apps/cli");
  git("commit", "--quiet", "-m", "fixture: initial");
  await writeFile(resolve(root, "apps/cli/dist/bin.js"), "built\n");
  await writeFile(manifest, "generated manifest\n");
  const input = { repositoryRoot: root, artifactDirectory: resolve(root, "archive") };
  const receipt = await createCiBuildTransfer(input);
  expect(receipt.files).toEqual([
    "apps/cli/release-artifact-manifest.json",
    "apps/cli/release-sbom.cdx.json",
  ]);
  git("checkout", "--", "apps/cli");
  await restoreCiBuildTransfer(input);
  expect(await readFile(manifest, "utf8")).toBe("generated manifest\n");
  expect(await readFile(sbom, "utf8")).toBe("committed sbom\n");

  const receiptPath = resolve(input.artifactDirectory, "receipt.json");
  for (const files of [
    undefined,
    ["apps/cli/package.json"],
    [receipt.files[0], receipt.files[0]],
  ]) {
    await writeFile(receiptPath, JSON.stringify({ ...receipt, files }));
    await expect(restoreCiBuildTransfer(input)).rejects.toThrow("ci_build_files_invalid");
  }
  // A listed file outside the archive's receipt is an out-of-scope member.
  await writeFile(receiptPath, JSON.stringify({ ...receipt, files: [receipt.files[1]] }));
  await expect(restoreCiBuildTransfer(input)).rejects.toThrow("ci_build_archive_path_invalid");
  expect(await readFile(manifest, "utf8")).toBe("generated manifest\n");
});

it("rejects corrupt or missing archives", async () => {
  const f = await fixture();
  await writeFile(resolve(f.input.artifactDirectory, "workspace-build.tar"), "corrupt");
  await expect(restoreCiBuildTransfer(f.input)).rejects.toThrow("ci_build_digest_mismatch");
  await rm(resolve(f.input.artifactDirectory, "workspace-build.tar"));
  await expect(restoreCiBuildTransfer(f.input)).rejects.toMatchObject({ code: "ENOENT" });
});
