import { formatFirstPublicationMetadataChange } from
  "./first-publication-metadata-change-formatter.mjs";

const requirementMessages = {
  license_approval: "The selected license's suitability for public distribution requires separate approval.",
  public_package_availability: "Verify whether @lervo/cli is available on public npm.",
  scope_control_confirmation: "Verify actual control of the @lervo npm scope.",
  first_publication_approval: "One direct first publication and the subsequent stage-only transition require separate approval.",
};

export function formatFirstPublicationMetadataPreview(preview) {
  const scopeKind = preview.target.scopeOwner.kind === "organization" ? "organization" : "user";
  const lines = [
    "CLI first-publication metadata change preview",
    `Target: ${preview.target.package}@${preview.target.version}`,
    `Selected description: ${preview.target.description}`,
    `Selected repository: ${preview.target.repository}`,
    `Selected license: ${preview.target.license}`,
    `Selected npm scope owner: ${scopeKind} ${preview.target.scopeOwner.name}`,
    "This selection is not publication approval.",
    "",
    "package.json changes:",
  ];
  if (preview.packageManifestChanges.length === 0) {
    lines.push("- No changes are required.");
  } else {
    for (const change of preview.packageManifestChanges) {
      lines.push(`- ${formatFirstPublicationMetadataChange(change, { currentState: true })}`);
    }
  }
  lines.push("", "release manifest:");
  lines.push(preview.releaseManifestRegeneration.status === "required"
    ? "- Regenerate it from package metadata. Do not edit the generated file directly."
    : "- It already matches the current selection and does not need regeneration.");
  lines.push("", "External checks and approvals still required:");
  for (const requirement of preview.remainingRequirements) {
    lines.push(`- ${requirementMessages[requirement.id] ?? "Separate verification is required."}`);
  }
  lines.push(
    "",
    "This command did not perform online checks, modify files, regenerate the release manifest, create approvals, activate publication, or publish a package.",
  );
  return `${lines.join("\n")}\n`;
}
