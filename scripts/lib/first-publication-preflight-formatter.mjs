const checkLabels = {
  bootstrap_freshness: "Approval validity interval",
  release_artifact: "Publication artifact",
  public_package_absence: "Public package name",
  reservation_state: "One-time reservation",
  npm_interactive_readiness: "Interactive npm readiness",
};

const reasonMessages = {
  check_precedes_observation: "The check time precedes the package observation time.",
  bootstrap_expired: "The public package-name observation has expired.",
  artifact_unavailable: "The package artifact to publish could not be read safely.",
  artifact_changed: "The package artifact to publish differs from the approved artifact.",
  registry_unavailable: "Package existence could not be checked on public npm.",
  public_package_exists: "The same package already exists on public npm.",
  reservation_store_unavailable: "The one-time reservation state could not be read safely.",
  publication_already_reserved: "The same first-publication approval is already reserved.",
  publication_already_terminal: "The same first-publication approval is already terminal.",
  terminal_not_interactive: "Run this in a terminal where commands are entered directly.",
  automation_environment_detected:
    "Manual first publication is not prepared in an automation environment.",
  registry_credential_in_environment:
    "npm credentials were found in environment variables, so preparation stopped.",
  npm_client_unavailable: "The npm command could not be run.",
  npm_client_unsupported: "npm 11.5.1 or later is required.",
  npm_profile_unavailable:
    "The npm account two-factor authentication setting could not be verified.",
  npm_write_2fa_not_ready:
    "The npm account is not configured to require two-factor authentication for publication.",
};

export function formatFirstPublicationPreflight(report) {
  const lines = [
    `CLI first-publication preflight: ${report.status === "ready" ? "ready" : "blocked"}`,
  ];
  for (const check of report.checks) {
    const status =
      check.status === "ready" ? "ready" : check.status === "unknown" ? "unknown" : "blocked";
    lines.push(`- ${checkLabels[check.id] ?? check.id}: ${status}`);
    for (const reason of check.reasons) {
      lines.push(`  ${reasonMessages[reason] ?? "A readiness condition could not be verified."}`);
    }
  }
  lines.push(
    "This result is not execution authorization. It did not create a reservation, publish a package, or change external configuration.",
  );
  return `${lines.join("\n")}\n`;
}
