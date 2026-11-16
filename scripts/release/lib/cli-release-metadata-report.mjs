import {
  canonicalJson,
  releaseArchiveFileDifferences,
  releaseArtifactDifferences,
} from "../../shared/release-artifact-manifest.mjs";

const maximumListedEntries = 40;

function listed(title, entries) {
  if (entries.length === 0) return [];
  const shown = entries.slice(0, maximumListedEntries).map((entry) => `- \`${entry}\``);
  const omitted = entries.length - shown.length;
  return [
    "",
    `${title}:`,
    "",
    ...shown,
    ...(omitted > 0 ? [`- ${omitted} more; see the uploaded files`] : []),
  ];
}

function setChanges(committed = [], generated = []) {
  const before = new Set(committed);
  const after = new Set(generated);
  return [
    ...generated.filter((entry) => !before.has(entry)).map((entry) => `+ ${entry}`),
    ...committed.filter((entry) => !after.has(entry)).map((entry) => `- ${entry}`),
  ];
}

const guidance = {
  generated:
    "This build changes the CLI release manifest or SBOM. The next release preparation generates " +
    "and commits them, so this change needs no metadata commit.",
  exact:
    "This run requires the committed CLI release manifest and SBOM to equal this build, because " +
    "the CLI version is not released yet or the change edits them. Commit the generated files.",
};

/**
 * Describes, as Markdown, how the release manifest and SBOM generated from this build differ from
 * the committed ones (ADR-0572). `releaseMetadata` is the run's verification mode; anything but
 * `generated` reads as `exact`. The description names only manifest sections, packaged file paths
 * with sizes and digests, package coordinates, and SBOM counts, never file contents.
 */
export function describeCliReleaseMetadataChange({
  releaseMetadata,
  committedManifest,
  generatedManifest,
  committedSbom,
  generatedSbom,
}) {
  const sections = releaseArtifactDifferences(committedManifest, generatedManifest);
  const sbomChanged = canonicalJson(committedSbom) !== canonicalJson(generatedSbom);
  if (sections.length === 0 && !sbomChanged)
    return "### CLI release metadata\n\nThe committed manifest and SBOM match this build.\n";
  const lines = [
    "### CLI release metadata",
    "",
    `${guidance[releaseMetadata === "generated" ? "generated" : "exact"]} The generated files are ` +
      "uploaded as `lervo-cli-release-metadata`.",
    "",
    `- Manifest sections: ${sections.length > 0 ? sections.join(", ") : "none"}`,
    `- SBOM components: ${committedSbom?.components?.length ?? "missing"} → ` +
      `${generatedSbom?.components?.length ?? "missing"}${sbomChanged ? "" : " (unchanged)"}`,
    ...listed(
      "Packaged files",
      sections.includes("archive")
        ? releaseArchiveFileDifferences(committedManifest.archive, generatedManifest.archive)
        : [],
    ),
    ...listed(
      "Bundled workspace packages",
      setChanges(
        committedManifest.bundle?.workspacePackages,
        generatedManifest.bundle?.workspacePackages,
      ),
    ),
    ...listed(
      "Portable dependencies",
      setChanges(
        committedManifest.dependencies?.portable,
        generatedManifest.dependencies?.portable,
      ),
    ),
  ];
  return `${lines.join("\n")}\n`;
}
