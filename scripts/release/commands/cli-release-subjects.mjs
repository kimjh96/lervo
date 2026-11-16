import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import {
  createReleaseSubjectsBinding,
  ReleaseSubjectsError,
  releaseSubjectsBindingName,
  releaseTarballName,
  verifyReleaseSubjects,
} from "../lib/cli-release-subjects.mjs";

// Usage:
//   cli-release-subjects.mjs bind <directory>                  bind prepared files to this checkout
//   cli-release-subjects.mjs confirm <directory>               repack after smokes; bytes must match
//   cli-release-subjects.mjs verify <directory> --expected-tag v<version>
const repositoryRoot = resolve(import.meta.dirname, "../../..");
const maximumSubjectFiles = 8;

function usage() {
  throw new ReleaseSubjectsError(
    "release_subjects_arguments_invalid",
    "The release subject command arguments are invalid.",
  );
}

function parseArguments([mode, directory, ...rest]) {
  if (!["bind", "confirm", "verify"].includes(mode) || !directory || !isAbsolute(directory))
    usage();
  if (mode === "verify") {
    if (rest.length !== 2 || rest[0] !== "--expected-tag") usage();
    return { mode, directory, expectedTag: rest[1] };
  }
  if (rest.length !== 0) usage();
  return { mode, directory };
}

const git = (...args) =>
  execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();

async function readRepositoryRelease() {
  const [manifest, sbom] = await Promise.all([
    readFile(resolve(repositoryRoot, "apps/cli/release-artifact-manifest.json")),
    readFile(resolve(repositoryRoot, "apps/cli/release-sbom.cdx.json")),
  ]);
  return { manifest, sbom, version: JSON.parse(manifest.toString("utf8")).artifact?.version };
}

async function readSubjectDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length > maximumSubjectFiles || entries.some((entry) => !entry.isFile()))
    throw new ReleaseSubjectsError(
      "release_subjects_file_set_mismatch",
      "The release subject file set is not exact.",
    );
  const files = new Map();
  for (const entry of entries)
    files.set(entry.name, await readFile(resolve(directory, entry.name)));
  const bindingContents = files.get(releaseSubjectsBindingName);
  files.delete(releaseSubjectsBindingName);
  return { bindingContents, files };
}

async function bind(directory) {
  const release = await readRepositoryRelease();
  const { bindingContents, files } = await readSubjectDirectory(directory);
  if (bindingContents !== undefined)
    throw new ReleaseSubjectsError(
      "release_subjects_file_set_mismatch",
      "The release subjects are already bound.",
    );
  const binding = createReleaseSubjectsBinding({
    version: release.version,
    revision: git("rev-parse", "HEAD"),
    tree: git("rev-parse", "HEAD^{tree}"),
    files,
  });
  await writeFile(
    resolve(directory, releaseSubjectsBindingName),
    `${JSON.stringify(binding, null, 2)}\n`,
    { flag: "wx" },
  );
  return binding;
}

async function verify(directory, expectedTag) {
  const release = await readRepositoryRelease();
  const { bindingContents, files } = await readSubjectDirectory(directory);
  return verifyReleaseSubjects({
    expectedTag,
    tree: git("rev-parse", "HEAD^{tree}"),
    bindingContents: bindingContents ?? Buffer.alloc(0),
    files,
    repository: release,
  });
}

/**
 * The packed smokes pack their own tarball from the same build. Repacking after them and requiring
 * identical bytes proves that the published tarball is the one those smokes installed.
 */
async function confirm(directory) {
  const release = await readRepositoryRelease();
  const binding = await verify(directory, `v${release.version}`);
  const { packCliArtifact } = await import("../../distribution/lib/packed-cli-artifact.mjs");
  const temporary = await mkdtemp(resolve(tmpdir(), "lervo-release-repack-"));
  try {
    const repacked = await readFile(await packCliArtifact(temporary, binding.version));
    const original = await readFile(resolve(directory, releaseTarballName(binding.version)));
    if (!repacked.equals(original))
      throw new ReleaseSubjectsError(
        "release_subjects_pack_unstable",
        "Repacking the verified build produced different tarball bytes.",
      );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return binding;
}

try {
  const command = parseArguments(process.argv.slice(2));
  const binding =
    command.mode === "bind"
      ? await bind(command.directory)
      : command.mode === "confirm"
        ? await confirm(command.directory)
        : await verify(command.directory, command.expectedTag);
  console.log(
    `CLI release subjects ${command.mode} passed ` +
      `(${binding.tag}, tree ${binding.tree}, ${binding.files.length} files)`,
  );
} catch (error) {
  if (error instanceof ReleaseSubjectsError) console.error(`${error.code}: ${error.message}`);
  else console.error("release_subjects_failed: The release subject command could not complete.");
  process.exitCode = 1;
}
