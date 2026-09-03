const externalMessages = {
  license_approval: "Approval is required to use the selected license for public distribution.",
  public_package_availability: "The package name must be checked for availability on public npm.",
  scope_control_confirmation: "Control of the @lervo scope on npm must be confirmed.",
  first_publication_approval:
    "Approval must cover the first direct publication and the subsequent publishing-path transition.",
};

export function formatFirstPublicationPackageMetadataPostApplyReport(report) {
  const lines = [
    "CLI first-publication package metadata post-apply verification complete",
    "- The current package.json matches the apply receipt.",
    "- The release manifest matches a rebuild from the current package metadata.",
    "- The release SBOM matches the current manifest and lockfile.",
    "- All local metadata blockers are resolved.",
    "",
    "Items that still require separate confirmation or approval:",
  ];
  for (const item of report.externalRequirements) {
    lines.push(`- ${externalMessages[item.id] ?? "External confirmation is required."}`);
  }
  lines.push(
    "",
    "The receipt signature and issuer were not verified.",
    "No files were modified, and no online checks, approval creation, publishing activation, or package publication were performed.",
  );
  return `${lines.join("\n")}\n`;
}
