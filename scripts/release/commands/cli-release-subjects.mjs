import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import {
  bindSubjectDirectory,
  verifySubjectDirectory,
} from "../lib/cli-release-subject-directory.mjs";
import { ReleaseSubjectsError } from "../lib/cli-release-subjects.mjs";
import { expectedPackedPackageManifest } from "../lib/packed-package-manifest.mjs";
import { readWorkspacePackageVersions } from "../lib/workspace-package-versions.mjs";

// Usage:
//   cli-release-subjects.mjs bind <directory>      bind freshly prepared files to this checkout
//   cli-release-subjects.mjs confirm <directory>   after the smokes: files are still the bound bytes
//   cli-release-subjects.mjs verify <directory> --expected-tag v<version>
const repositoryRoot = resolve(import.meta.dirname, "../../..");

function parseArguments([mode, directory, ...rest]) {
  const valid =
    ["bind", "confirm", "verify"].includes(mode) &&
    typeof directory === "string" &&
    isAbsolute(directory) &&
    (mode === "verify" ? rest.length === 2 && rest[0] === "--expected-tag" : rest.length === 0);
  if (!valid)
    throw new ReleaseSubjectsError(
      "release_subjects_arguments_invalid",
      "The release subject command arguments are invalid.",
    );
  return { mode, directory, expectedTag: rest[1] };
}

const git = (...args) =>
  execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();

async function readRepositoryRelease() {
  const [manifest, sbom, packageSource, workspaceVersions] = await Promise.all([
    readFile(resolve(repositoryRoot, "apps/cli/release-artifact-manifest.json")),
    readFile(resolve(repositoryRoot, "apps/cli/release-sbom.cdx.json")),
    readFile(resolve(repositoryRoot, "apps/cli/package.json"), "utf8"),
    readWorkspacePackageVersions(repositoryRoot),
  ]);
  return {
    version: JSON.parse(manifest.toString("utf8")).artifact?.version,
    repository: {
      manifest,
      sbom,
      packageManifest: expectedPackedPackageManifest(JSON.parse(packageSource), workspaceVersions),
    },
  };
}

async function run({ mode, directory, expectedTag }) {
  const release = await readRepositoryRelease();
  if (mode === "bind")
    return bindSubjectDirectory({
      directory,
      version: release.version,
      revision: git("rev-parse", "HEAD"),
      tree: git("rev-parse", "HEAD^{tree}"),
    });
  return verifySubjectDirectory({
    directory,
    expectedTag: mode === "confirm" ? `v${release.version}` : expectedTag,
    tree: git("rev-parse", "HEAD^{tree}"),
    repository: release.repository,
  });
}

try {
  const command = parseArguments(process.argv.slice(2));
  const binding = await run(command);
  console.log(
    `CLI release subjects ${command.mode} passed ` +
      `(${binding.tag}, tree ${binding.tree}, ${binding.files.length} files)`,
  );
} catch (error) {
  if (error instanceof ReleaseSubjectsError) console.error(`${error.code}: ${error.message}`);
  else console.error("release_subjects_failed: The release subject command could not complete.");
  process.exitCode = 1;
}
