import { createHash } from "node:crypto";

import { CommandFailure } from "./command-error-output.js";
import { readNpmTarballEntries } from "./host-release-tarball.js";

/**
 * ADR-0570: a host installs only the release files that the tag's published GitHub Release
 * carries and that verify against the tag's own committed bytes. The checks repeat ADR-0569's
 * publication checks from the host's side, without a repository checkout: the binding must name
 * the published tag and the tree that tag points at, every file must match its bound size and
 * digest, the manifest and SBOM must equal the tag's committed bytes, and the tarball must hold
 * exactly the files that manifest lists. Failure codes are the publication verifier's codes.
 */
export const RELEASE_SUBJECTS_BINDING = "release-subjects.json";
export const RELEASE_MANIFEST_SUBJECT = "release-artifact-manifest.json";
export const RELEASE_SBOM_SUBJECT = "release-sbom.cdx.json";
/** The tag's committed files that the published subjects must match. */
export const COMMITTED_RELEASE_PATHS = {
  manifest: "apps/cli/release-artifact-manifest.json",
  sbom: "apps/cli/release-sbom.cdx.json",
  packageManifest: "apps/cli/package.json",
} as const;

const maximumBindingBytes = 64 * 1024;
const versionPattern = /^\d+\.\d+\.\d+$/u;
const objectIdPattern = /^[a-f0-9]{40}$/u;
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const workspaceRangePattern = /^workspace:([*^~])$/u;
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

export interface PublishedReleaseEvidence {
  tag: string;
  /** The commit and tree the published tag points at, read from the release source. */
  commit: { sha: string; tree: string };
  bindingContents: Buffer;
  /** Every downloaded file other than the binding, by name. */
  files: ReadonlyMap<string, Buffer>;
  committed: { manifest: Buffer; sbom: Buffer; packageManifest: Buffer };
}

export interface VerifiedRelease {
  tag: string;
  version: string;
  commit: string;
  tree: string;
  tarballName: string;
  tarballSha256: string;
  /** The runtime dependencies the verified package declares, installed beside it. */
  dependencies: Record<string, string>;
  /** Every npm package the install may contain, from the tag's committed manifest. */
  dependencyClosure: ReleaseDependencyClosure;
}

interface BindingFile {
  name: string;
  size: number;
  sha256: string;
}

interface Binding {
  version: string;
  tag: string;
  tree: string;
  files: BindingFile[];
}

const fail = (code: string, message: string): never => {
  throw new CommandFailure(code, message);
};
const canonicalJson = (value: unknown): string => `${JSON.stringify(value)}\n`;
const sha256 = (contents: Buffer): string =>
  `sha256:${createHash("sha256").update(contents).digest("hex")}`;

export function releaseTarballName(version: string): string {
  return `lervo-cli-${version}.tgz`;
}

/** The exact files a release publishes beside the binding, sorted by name. */
export function releaseSubjectNames(version: string): string[] {
  return [releaseTarballName(version), RELEASE_MANIFEST_SUBJECT, RELEASE_SBOM_SUBJECT].sort();
}

function sortedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, sortedValue(record[key])]),
  );
}

function parseJson(contents: Buffer, code: string, message: string): unknown {
  try {
    return JSON.parse(contents.toString("utf8")) as unknown;
  } catch {
    return fail(code, message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseBinding(contents: Buffer): Binding {
  const invalid = "The release subject binding is invalid.";
  if (contents.length === 0 || contents.length > maximumBindingBytes)
    fail("release_subjects_binding_invalid", invalid);
  const binding = parseJson(contents, "release_subjects_binding_invalid", invalid);
  const valid =
    isRecord(binding) &&
    canonicalJson(Object.keys(binding).sort()) ===
      canonicalJson(["artifact", "files", "revision", "schemaVersion", "tag", "tree", "version"]) &&
    binding.schemaVersion === 1 &&
    binding.artifact === "@lervo/cli" &&
    typeof binding.version === "string" &&
    versionPattern.test(binding.version) &&
    binding.tag === `v${binding.version}` &&
    typeof binding.revision === "string" &&
    objectIdPattern.test(binding.revision) &&
    typeof binding.tree === "string" &&
    objectIdPattern.test(binding.tree) &&
    Array.isArray(binding.files) &&
    canonicalJson(binding.files.map((file: unknown) => (isRecord(file) ? file.name : null))) ===
      canonicalJson(releaseSubjectNames(binding.version)) &&
    binding.files.every(
      (file: unknown) =>
        isRecord(file) &&
        canonicalJson(Object.keys(file).sort()) === canonicalJson(["name", "sha256", "size"]) &&
        Number.isSafeInteger(file.size) &&
        (file.size as number) >= 0 &&
        typeof file.sha256 === "string" &&
        digestPattern.test(file.sha256),
    );
  if (!valid) fail("release_subjects_binding_invalid", invalid);
  return binding as unknown as Binding;
}

/** The exact npm packages a release was built and verified with (the manifest's closure). */
export interface ReleaseDependencyClosure {
  /** `name@version` for every portable package. */
  portable: string[];
  /** Platform-specific packages: any name with the prefix, at exactly this version. */
  platformFamilies: { prefix: string; version: string }[];
}

interface ArchiveContract {
  name: string;
  version: string;
  files: { path: string; size: number; sha256: string }[];
  closure: ReleaseDependencyClosure;
}

const packageCoordinatePattern =
  /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*@\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/u;

function readDependencyClosure(value: unknown): ReleaseDependencyClosure | null {
  if (!isRecord(value) || !Array.isArray(value.portable)) return null;
  const families = value.platformSpecificFamilies ?? [];
  if (
    !value.portable.every(
      (entry: unknown) => typeof entry === "string" && packageCoordinatePattern.test(entry),
    ) ||
    !Array.isArray(families) ||
    !families.every(
      (family: unknown) =>
        isRecord(family) &&
        typeof family.prefix === "string" &&
        family.prefix.length > 0 &&
        typeof family.version === "string" &&
        versionPattern.test(family.version),
    )
  )
    return null;
  return {
    portable: value.portable as string[],
    platformFamilies: (families as { prefix: string; version: string }[]).map(
      ({ prefix, version }) => ({ prefix, version }),
    ),
  };
}

function readArchiveContract(contents: Buffer): ArchiveContract {
  const invalid = "The release artifact manifest is invalid.";
  const manifest = parseJson(contents, "release_subjects_metadata_mismatch", invalid);
  const artifact = isRecord(manifest) ? manifest.artifact : undefined;
  const archive = isRecord(manifest) ? manifest.archive : undefined;
  const closure = isRecord(manifest) ? readDependencyClosure(manifest.dependencies) : null;
  const valid =
    closure !== null &&
    isRecord(artifact) &&
    typeof artifact.name === "string" &&
    typeof artifact.version === "string" &&
    isRecord(archive) &&
    canonicalJson(archive.rootFiles) === canonicalJson(["package.json"]) &&
    Array.isArray(archive.files) &&
    archive.files.every(
      (file: unknown) =>
        isRecord(file) &&
        typeof file.path === "string" &&
        file.path !== "package.json" &&
        Number.isSafeInteger(file.size) &&
        typeof file.sha256 === "string" &&
        digestPattern.test(file.sha256),
    );
  if (!valid) fail("release_subjects_metadata_mismatch", invalid);
  return {
    name: (artifact as { name: string }).name,
    version: (artifact as { version: string }).version,
    files: (archive as { files: ArchiveContract["files"] }).files,
    closure: closure as ReleaseDependencyClosure,
  };
}

function dependencyValueMatches(fieldName: string, expected: unknown, actual: unknown): boolean {
  const workspace = typeof expected === "string" ? workspaceRangePattern.exec(expected) : null;
  // A workspace range outside devDependencies would be installed from the registry at a version
  // the tarball's uploader chose, so only devDependencies may resolve it.
  if (workspace === null || fieldName !== "devDependencies") return expected === actual;
  // The host has no checkout to read workspace versions from; workspace packages are bundled into
  // dist/ and never installed, so only the resolved form is checked here. Publication already
  // compared the exact versions (ADR-0569).
  const prefix = workspace[1] === "*" ? "" : workspace[1];
  return (
    typeof actual === "string" &&
    actual.startsWith(prefix ?? "") &&
    versionPattern.test(actual.slice((prefix ?? "").length))
  );
}

/**
 * The tarball's package manifest must equal the tag's `apps/cli/package.json` in every field, in
 * any key order, with each `workspace:` range replaced by a version. A changed script, bin entry,
 * engine, or dependency fails.
 */
function verifyPackageManifest(actual: Record<string, unknown>, committed: Buffer): void {
  const mismatch = (): never =>
    fail(
      "release_subjects_package_manifest_mismatch",
      "The release tarball package manifest differs from the released tree.",
    );
  const expected = parseJson(
    committed,
    "release_subjects_package_manifest_mismatch",
    "The released tree's package manifest is invalid.",
  );
  if (!isRecord(expected)) return mismatch();
  const withoutDependencies = (manifest: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(manifest).filter(
        ([key]) => !(dependencyFields as readonly string[]).includes(key),
      ),
    );
  if (
    canonicalJson(sortedValue(withoutDependencies(actual))) !==
    canonicalJson(sortedValue(withoutDependencies(expected)))
  )
    mismatch();
  for (const fieldName of dependencyFields) {
    const expectedField = expected[fieldName] ?? {};
    const actualField = actual[fieldName] ?? {};
    if (!isRecord(expectedField) || !isRecord(actualField)) return mismatch();
    if (
      canonicalJson(Object.keys(expectedField).sort()) !==
      canonicalJson(Object.keys(actualField).sort())
    )
      mismatch();
    for (const [name, range] of Object.entries(expectedField))
      if (!dependencyValueMatches(fieldName, range, actualField[name])) mismatch();
  }
}

function verifyArchive(
  tarball: Buffer,
  contract: ArchiveContract,
  committedPackageManifest: Buffer,
): Record<string, string> {
  let entries: Map<string, Buffer>;
  try {
    entries = readNpmTarballEntries(tarball);
  } catch {
    return fail("release_subjects_archive_mismatch", "The release tarball cannot be read.");
  }
  const expectedPaths = ["package.json", ...contract.files.map((file) => file.path)].sort();
  if (canonicalJson([...entries.keys()].sort()) !== canonicalJson(expectedPaths))
    fail(
      "release_subjects_archive_mismatch",
      "The release tarball file set differs from the manifest.",
    );
  for (const file of contract.files) {
    const contents = entries.get(file.path) as Buffer;
    if (contents.length !== file.size || sha256(contents) !== file.sha256)
      fail(
        "release_subjects_archive_mismatch",
        "A release tarball file differs from the manifest.",
      );
  }
  const packageManifest = parseJson(
    entries.get("package.json") as Buffer,
    "release_subjects_archive_mismatch",
    "The release tarball package manifest is invalid.",
  );
  if (
    !isRecord(packageManifest) ||
    packageManifest.name !== contract.name ||
    packageManifest.version !== contract.version
  )
    return fail(
      "release_subjects_archive_mismatch",
      "The release tarball package identity differs.",
    );
  verifyPackageManifest(packageManifest, committedPackageManifest);
  const dependencies = packageManifest.dependencies ?? {};
  if (!isRecord(dependencies) || Object.values(dependencies).some((v) => typeof v !== "string"))
    fail(
      "release_subjects_package_manifest_mismatch",
      "The release tarball runtime dependencies are invalid.",
    );
  return dependencies as Record<string, string>;
}

/** Proves that downloaded release files are the published, bound bytes of the requested tag. */
export function verifyPublishedRelease(evidence: PublishedReleaseEvidence): VerifiedRelease {
  const binding = parseBinding(evidence.bindingContents);
  if (binding.tag !== evidence.tag)
    fail("release_subjects_tag_mismatch", "The release subjects belong to another tag.");
  if (binding.tree !== evidence.commit.tree)
    fail("release_subjects_tree_mismatch", "The release subjects were built from another tree.");
  if (
    canonicalJson([...evidence.files.keys()].sort()) !==
    canonicalJson(releaseSubjectNames(binding.version))
  )
    fail("release_subjects_file_set_mismatch", "The release subject file set is not exact.");
  for (const expected of binding.files) {
    const contents = evidence.files.get(expected.name) as Buffer;
    if (contents.length !== expected.size || sha256(contents) !== expected.sha256)
      fail("release_subjects_digest_mismatch", "A release subject differs from its binding.");
  }
  const manifest = evidence.files.get(RELEASE_MANIFEST_SUBJECT) as Buffer;
  if (
    !manifest.equals(evidence.committed.manifest) ||
    !(evidence.files.get(RELEASE_SBOM_SUBJECT) as Buffer).equals(evidence.committed.sbom)
  )
    fail(
      "release_subjects_metadata_mismatch",
      "The release metadata differs from the released tree.",
    );
  const contract = readArchiveContract(manifest);
  if (contract.name !== "@lervo/cli" || contract.version !== binding.version)
    fail("release_subjects_metadata_mismatch", "The release manifest names another version.");
  const tarballName = releaseTarballName(binding.version);
  const tarball = evidence.files.get(tarballName) as Buffer;
  const dependencies = verifyArchive(tarball, contract, evidence.committed.packageManifest);
  return {
    tag: binding.tag,
    version: binding.version,
    commit: evidence.commit.sha,
    tree: binding.tree,
    tarballName,
    tarballSha256: sha256(tarball),
    dependencies,
    dependencyClosure: contract.closure,
  };
}
