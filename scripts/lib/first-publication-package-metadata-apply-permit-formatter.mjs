export function formatFirstPublicationPackageMetadataApplyPermit(permit) {
  const scopeKind = permit.selection.scopeOwner.kind === "organization" ? "organization" : "user";
  const lines = [
    "CLI first-publication package.json apply permit",
    `Target: ${permit.target.package}@${permit.target.version}`,
    `Reviewed repository: ${permit.selection.repository}`,
    `Reviewed license: ${permit.selection.license}`,
    `Reviewed npm scope owner: ${scopeKind} ${permit.selection.scopeOwner.name}`,
    "Status: Package.json replacement is permitted only while the reviewed source and candidate remain unchanged.",
    "",
    "This permit is invalid if the source changes.",
    "The release manifest must be rebuilt after applying package.json, not edited directly.",
    "This command did not modify files, rebuild the release manifest, activate publishing, or publish the package.",
  ];
  return `${lines.join("\n")}\n`;
}
