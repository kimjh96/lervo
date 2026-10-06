import type { ContinuityDoctorReport } from "./knowledge-convergence-doctor-inspection.js";

/** Human-readable continuity doctor report; `--json` prints the report itself. */
export function formatContinuityDoctor(report: ContinuityDoctorReport): string {
  const lines = [
    `Lervo knowledge continuity: ${report.status}`,
    `host policy: ${report.policy.state}${report.policy.horizonAt === null ? "" : ` until ${report.policy.horizonAt}`}${report.policy.authority === null ? "" : ` (${report.policy.authority})`}`,
    `repositories: ${report.summary.repositories} · owner decisions ${report.summary.ownerDecisions} · attention ${report.summary.attention} · info ${report.summary.info}`,
  ];
  for (const repository of report.repositories) {
    lines.push(
      "",
      `${repository.name ?? repository.repositoryRoot} (${repository.repositoryRoot})`,
      `  host ${repository.hostLabel ?? "unobserved"} · owner-host ${repository.ownerHost} · delegation ${repository.delegation.state}${repository.delegation.expiresAt === null ? "" : ` until ${repository.delegation.expiresAt}`} · lease ${repository.verdict?.role ?? "unobserved"}${repository.verdict?.holderLabel ? ` (${repository.verdict.holderLabel})` : ""} · publication ${repository.publication ?? "none"} · resident ${repository.resident ?? "none"}`,
      `  peers (${repository.peers.source}): ${repository.peers.hosts.length === 0 ? "none" : repository.peers.hosts.map((peer) => `${peer.hostLabel} delegation ${peer.delegationState}`).join(", ")}`,
    );
    for (const finding of repository.findings)
      lines.push(
        `  ${finding.severity} ${finding.code}${finding.detail === null ? "" : ` (${finding.detail})`}`,
        `    ${finding.remediation}`,
      );
  }
  return `${lines.join("\n")}\n`;
}
