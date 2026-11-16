import { createHash } from "node:crypto";

import { readNpmTarballEntries } from "./npm-tarball-entries.mjs";

export const releaseSubjectsBindingName = "release-subjects.json";
const releaseSubjectsSchemaVersion = 1;
const releaseManifestSubjectName = "release-artifact-manifest.json";
const releaseSbomSubjectName = "release-sbom.cdx.json";

const maximumBindingBytes = 64 * 1024;
const versionPattern = /^\d+\.\d+\.\d+$/u;
const objectIdPattern = /^[a-f0-9]{40}$/u;
const digestPattern = /^sha256:[a-f0-9]{64}$/u;

export class ReleaseSubjectsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReleaseSubjectsError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReleaseSubjectsError(code, message);
}

// Local copies of the manifest module's encodings: that module loads built workspace packages, and
// publication verifies before any install or build.
const canonicalJson = (value) => `${JSON.stringify(value)}\n`;
const sha256 = (contents) => `sha256:${createHash("sha256").update(contents).digest("hex")}`;

export function releaseTarballName(version) {
  return `lervo-cli-${version}.tgz`;
}

/** The exact files a release publishes beside the binding, sorted by name. */
export function releaseSubjectNames(version) {
  return [releaseTarballName(version), releaseManifestSubjectName, releaseSbomSubjectName].sort();
}

function describe(name, contents) {
  return { name, size: contents.length, sha256: sha256(contents) };
}

/**
 * Binds the exact release files to the tree and revision that produced them. The tag that later
 * publishes them must name a commit with this tree; the revision is recorded for traceability only,
 * because a merge commit has a different identity but the same tree.
 */
export function createReleaseSubjectsBinding({ version, revision, tree, files }) {
  if (
    !versionPattern.test(version) ||
    !objectIdPattern.test(revision) ||
    !objectIdPattern.test(tree)
  )
    fail("release_subjects_input_invalid", "The release subject coordinates are invalid.");
  const names = releaseSubjectNames(version);
  if (canonicalJson([...files.keys()].sort()) !== canonicalJson(names))
    fail("release_subjects_file_set_mismatch", "The release subject file set is not exact.");
  return {
    schemaVersion: releaseSubjectsSchemaVersion,
    artifact: "@lervo/cli",
    version,
    tag: `v${version}`,
    revision,
    tree,
    files: names.map((name) => describe(name, files.get(name))),
  };
}

function parseBinding(contents) {
  if (!Buffer.isBuffer(contents) || contents.length > maximumBindingBytes)
    fail("release_subjects_binding_invalid", "The release subject binding is invalid.");
  let binding;
  try {
    binding = JSON.parse(contents.toString("utf8"));
  } catch {
    fail("release_subjects_binding_invalid", "The release subject binding is invalid.");
  }
  const valid =
    binding !== null &&
    typeof binding === "object" &&
    canonicalJson(Object.keys(binding).sort()) ===
      canonicalJson(["artifact", "files", "revision", "schemaVersion", "tag", "tree", "version"]) &&
    binding.schemaVersion === releaseSubjectsSchemaVersion &&
    binding.artifact === "@lervo/cli" &&
    typeof binding.version === "string" &&
    versionPattern.test(binding.version) &&
    binding.tag === `v${binding.version}` &&
    objectIdPattern.test(binding.revision) &&
    objectIdPattern.test(binding.tree) &&
    Array.isArray(binding.files) &&
    canonicalJson(binding.files.map((file) => file?.name)) ===
      canonicalJson(releaseSubjectNames(binding.version)) &&
    binding.files.every(
      (file) =>
        canonicalJson(Object.keys(file).sort()) === canonicalJson(["name", "sha256", "size"]) &&
        Number.isSafeInteger(file.size) &&
        file.size >= 0 &&
        digestPattern.test(file.sha256),
    );
  if (!valid) fail("release_subjects_binding_invalid", "The release subject binding is invalid.");
  return binding;
}

function readArchiveContract(contents) {
  let manifest;
  try {
    manifest = JSON.parse(contents.toString("utf8"));
  } catch {
    fail("release_subjects_metadata_mismatch", "The release artifact manifest is invalid.");
  }
  const valid =
    typeof manifest?.artifact?.name === "string" &&
    typeof manifest.artifact.version === "string" &&
    canonicalJson(manifest.archive?.rootFiles) === canonicalJson(["package.json"]) &&
    Array.isArray(manifest.archive.files) &&
    manifest.archive.files.every(
      (file) =>
        typeof file?.path === "string" &&
        file.path !== "package.json" &&
        Number.isSafeInteger(file.size) &&
        digestPattern.test(file.sha256),
    );
  if (!valid)
    fail("release_subjects_metadata_mismatch", "The release artifact manifest is invalid.");
  return manifest;
}

function verifyArchive(tarball, manifest) {
  let entries;
  try {
    entries = readNpmTarballEntries(tarball);
  } catch {
    fail("release_subjects_archive_mismatch", "The release tarball cannot be read.");
  }
  const expectedPaths = [
    ...manifest.archive.rootFiles,
    ...manifest.archive.files.map((f) => f.path),
  ];
  if (canonicalJson([...entries.keys()].sort()) !== canonicalJson(expectedPaths.sort()))
    fail(
      "release_subjects_archive_mismatch",
      "The release tarball file set differs from the manifest.",
    );
  for (const file of manifest.archive.files) {
    const contents = entries.get(file.path);
    if (contents.length !== file.size || sha256(contents) !== file.sha256)
      fail(
        "release_subjects_archive_mismatch",
        "A release tarball file differs from the manifest.",
      );
  }
  let packageManifest;
  try {
    packageManifest = JSON.parse(entries.get("package.json").toString("utf8"));
  } catch {
    fail("release_subjects_archive_mismatch", "The release tarball package manifest is invalid.");
  }
  if (
    packageManifest?.name !== manifest.artifact.name ||
    packageManifest?.version !== manifest.artifact.version
  )
    fail("release_subjects_archive_mismatch", "The release tarball package identity differs.");
}

/**
 * Proves that downloaded release files are exactly the bound bytes, that they belong to the tree
 * being released, and that the tarball holds exactly the files the tree's committed manifest names.
 * `files` maps every file name found beside the binding to its bytes; `repository` holds the
 * committed manifest and SBOM bytes of the tree being released.
 */
export function verifyReleaseSubjects({ expectedTag, tree, bindingContents, files, repository }) {
  const binding = parseBinding(bindingContents);
  if (binding.tag !== expectedTag)
    fail("release_subjects_tag_mismatch", "The release subjects belong to another tag.");
  if (binding.tree !== tree)
    fail("release_subjects_tree_mismatch", "The release subjects were built from another tree.");
  if (
    canonicalJson([...files.keys()].sort()) !== canonicalJson(releaseSubjectNames(binding.version))
  )
    fail("release_subjects_file_set_mismatch", "The release subject file set is not exact.");
  for (const expected of binding.files) {
    if (
      canonicalJson(describe(expected.name, files.get(expected.name))) !== canonicalJson(expected)
    )
      fail("release_subjects_digest_mismatch", "A release subject differs from its binding.");
  }
  const manifestContents = files.get(releaseManifestSubjectName);
  if (
    !manifestContents.equals(repository.manifest) ||
    !files.get(releaseSbomSubjectName).equals(repository.sbom)
  )
    fail(
      "release_subjects_metadata_mismatch",
      "The release metadata differs from the released tree.",
    );
  // Byte equality with the released tree already binds the manifest that main CI verified, so only
  // the fields this check reads are validated here.
  const manifest = readArchiveContract(manifestContents);
  if (manifest.artifact.name !== binding.artifact || manifest.artifact.version !== binding.version)
    fail("release_subjects_metadata_mismatch", "The release manifest names another version.");
  verifyArchive(files.get(releaseTarballName(binding.version)), manifest);
  return binding;
}
