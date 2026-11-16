import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { RELEASE_METADATA_FILES } from "./ci-release-metadata.mjs";
import { CI_VERIFICATION_CONTRACT } from "./ci-verification-plan.mjs";

const maximumArchiveBytes = 512 * 1024 * 1024;
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const gitRevision = (root) =>
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

async function buildDirectories(root) {
  const directories = [];
  for (const group of ["apps", "packages"]) {
    for (const entry of await readdir(resolve(root, group), { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-z0-9-]+$/u.test(entry.name)) continue;
      const path = `${group}/${entry.name}/dist`;
      try {
        if ((await lstat(resolve(root, path))).isDirectory()) directories.push(path);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  if (directories.length === 0) throw new Error("ci_build_outputs_missing");
  return directories.sort();
}

/**
 * The release manifest and SBOM as this build left them: equal to the committed files when the run
 * checked them, generated from this build when it generated them (ADR-0572). Consumers restore
 * them, so every job of the run verifies the same metadata.
 */
async function releaseMetadataFiles(root) {
  const files = [];
  for (const path of RELEASE_METADATA_FILES) {
    try {
      if ((await lstat(resolve(root, path))).isFile()) files.push(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return files;
}

function identity(root) {
  return {
    schemaVersion: 1,
    verificationContract: CI_VERIFICATION_CONTRACT,
    revision: gitRevision(root),
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.version,
    workflow: process.env.GITHUB_WORKFLOW ?? "local",
    runId: process.env.GITHUB_RUN_ID ?? "local",
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "local",
  };
}

export async function createCiBuildTransfer({ repositoryRoot, artifactDirectory }) {
  const directories = await buildDirectories(repositoryRoot);
  const files = await releaseMetadataFiles(repositoryRoot);
  await mkdir(artifactDirectory, { recursive: true });
  const archive = resolve(artifactDirectory, "workspace-build.tar");
  execFileSync("tar", ["-cf", archive, "-C", repositoryRoot, ...directories, ...files]);
  if ((await lstat(archive)).size > maximumArchiveBytes)
    throw new Error("ci_build_archive_too_large");
  const bytes = await readFile(archive);
  if (bytes.length > maximumArchiveBytes) throw new Error("ci_build_archive_too_large");
  const receipt = {
    ...identity(repositoryRoot),
    buildDigest: digest(bytes),
    directories,
    files,
  };
  await writeFile(resolve(artifactDirectory, "receipt.json"), `${JSON.stringify(receipt)}\n`);
  return receipt;
}

export async function restoreCiBuildTransfer({ repositoryRoot, artifactDirectory }) {
  const receiptPath = resolve(artifactDirectory, "receipt.json");
  if ((await lstat(receiptPath)).size > 64 * 1024) throw new Error("ci_build_receipt_too_large");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  const expected = identity(repositoryRoot);
  const attemptValid =
    expected.runAttempt === "local"
      ? receipt.runAttempt === "local"
      : typeof receipt.runAttempt === "string" &&
        /^\d+$/u.test(receipt.runAttempt) &&
        Number(receipt.runAttempt) >= 1 &&
        Number(receipt.runAttempt) <= Number(expected.runAttempt);
  if (
    !attemptValid ||
    Object.entries(expected).some(([key, value]) => key !== "runAttempt" && receipt[key] !== value)
  )
    throw new Error("ci_build_identity_mismatch");
  if (
    !Array.isArray(receipt.directories) ||
    receipt.directories.length === 0 ||
    receipt.directories.length > 256 ||
    !receipt.directories.every((path) => /^(?:apps|packages)\/[a-z0-9-]+\/dist$/u.test(path))
  )
    throw new Error("ci_build_directories_invalid");
  if (
    !Array.isArray(receipt.files) ||
    new Set(receipt.files).size !== receipt.files.length ||
    !receipt.files.every((path) => RELEASE_METADATA_FILES.includes(path))
  )
    throw new Error("ci_build_files_invalid");
  const archive = resolve(artifactDirectory, "workspace-build.tar");
  const stat = await lstat(archive);
  if (!stat.isFile() || stat.size > maximumArchiveBytes)
    throw new Error("ci_build_archive_invalid");
  if (digest(await readFile(archive)) !== receipt.buildDigest)
    throw new Error("ci_build_digest_mismatch");
  const entries = execFileSync("tar", ["-tf", archive], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  })
    .trim()
    .split("\n");
  if (
    entries.some(
      (path) =>
        path.includes("\\") ||
        path.split("/").some((part) => part === "..") ||
        (!receipt.files.includes(path) &&
          !receipt.directories.some(
            (directory) => path === directory || path.startsWith(`${directory}/`),
          )),
    )
  )
    throw new Error("ci_build_archive_path_invalid");
  const listing = execFileSync("tar", ["-tvf", archive], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (
    listing
      .split("\n")
      .filter(Boolean)
      .some((line) => !["d", "-"].includes(line[0]))
  )
    throw new Error("ci_build_archive_entry_invalid");
  for (const path of [...receipt.directories, ...receipt.files]) {
    const [group, project] = path.split("/");
    for (const parent of [group, `${group}/${project}`])
      if (!(await lstat(resolve(repositoryRoot, parent))).isDirectory())
        throw new Error("ci_build_destination_invalid");
  }
  for (const path of [...receipt.directories, ...receipt.files])
    await rm(resolve(repositoryRoot, path), { recursive: true, force: true });
  execFileSync("tar", ["-xf", archive, "-C", repositoryRoot]);
  for (const path of receipt.directories)
    if (!(await lstat(resolve(repositoryRoot, path))).isDirectory())
      throw new Error("ci_build_outputs_missing");
  for (const path of receipt.files)
    if (!(await lstat(resolve(repositoryRoot, path))).isFile())
      throw new Error("ci_build_outputs_missing");
  return receipt;
}
