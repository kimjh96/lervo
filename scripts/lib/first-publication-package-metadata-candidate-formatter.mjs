import { formatFirstPublicationMetadataChange } from
  "./first-publication-metadata-change-formatter.mjs";

export function formatFirstPublicationPackageMetadataCandidate(candidate) {
  const lines = [
    "CLI first-publication package.json candidate",
    `Target: ${candidate.target.package}@${candidate.target.version}`,
    "Status: Review is required; this candidate cannot be applied yet.",
    "",
    "Changes included in the candidate:",
  ];
  for (const change of candidate.changes) {
    lines.push(`- ${formatFirstPublicationMetadataChange(change)}`);
  }
  lines.push(
    "",
    "Add --package-json to the same arguments to inspect the exact package.json content.",
    "This command did not modify files, rebuild the release manifest, create approvals, activate publishing, or publish the package.",
  );
  return `${lines.join("\n")}\n`;
}
