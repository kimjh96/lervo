const checkLabels = {
  package_identity: "Public CLI package name and version",
  repository_metadata: "Repository metadata",
  license_metadata: "License",
  publication_metadata: "npm publication configuration",
};

const reasonMessages = {
  package_name_mismatch: "The package name in package.json is not @lervo/cli.",
  package_version_mismatch: "The package.json and release manifest versions differ.",
  package_not_public: "package.json is not configured as a public package.",
  package_access_not_public: "The package.json publication access is not public.",
  package_repository_missing: "package.json has no GitHub repository.",
  package_repository_invalid: "The package.json GitHub repository format is invalid.",
  release_repository_missing: "The release manifest has no GitHub repository.",
  release_repository_invalid: "The release manifest GitHub repository format is invalid.",
  repository_mismatch: "The repositories in package.json and the release manifest differ.",
  package_license_unresolved: "The public license in package.json is unresolved.",
  release_license_unresolved: "The public license in the release manifest is unresolved.",
  license_mismatch: "The licenses in package.json and the release manifest differ.",
  package_registry_unpinned: "package.json does not pin the public npm registry.",
  release_registry_unpinned: "The release manifest does not pin the public npm registry.",
  package_provenance_unpinned: "package.json does not explicitly enable provenance.",
  release_provenance_unpinned: "The release manifest does not explicitly enable provenance.",
};

const externalMessages = {
  public_package_availability: "Verify whether @lervo/cli is available on public npm.",
  npm_scope_control: "A person must verify control of the @lervo npm scope.",
  first_publication_approval:
    "Separate approval must bind the license, package name, scope authority, one direct first publication, and the subsequent transition.",
};

export function formatFirstPublicationActivationBlockerReport(report) {
  const lines = [
    "CLI first-publication activation blockers",
    `Target: ${report.target.package}@${report.target.version}`,
    "Status: activation is not yet allowed, and publication activation is not implemented.",
    "",
    "Checks from local files:",
  ];
  for (const item of report.localChecks) {
    lines.push(`- ${checkLabels[item.id] ?? item.id}: ${item.status === "ready" ? "ready" : "action required"}`);
    for (const reason of item.reasons) {
      lines.push(`  ${reasonMessages[reason] ?? "The local configuration must be reviewed."}`);
    }
  }
  lines.push("", "Requirements not verifiable from local files:");
  for (const item of report.externalRequirements) {
    lines.push(`- ${externalMessages[item.id] ?? "External verification is required."}`);
  }
  lines.push(
    "",
    "This command did not perform online checks, modify files, create approvals, activate publication, or publish a package.",
  );
  return `${lines.join("\n")}\n`;
}
