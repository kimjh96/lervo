import type { NodeFleetStatusReport } from "./node-fleet-apply-contract.js";

/** Human text for `lervo repository node status`. */
export function formatNodeFleetStatus(report: NodeFleetStatusReport): string {
  if (report.instances.length === 0) return "No repository Node instances are registered.\n";
  const instances = report.instances.map((item) => {
    const executables = item.configuredExecutables;
    const lines = [
      `${item.projectId} · ${item.serviceInstanceId} · ${item.runtime.status}`,
      `  sync=${item.runtime.sync}; workstream=${item.runtime.workstreamReplication}; remote=${item.runtime.remoteControl}; recovery=${item.recoveryAction}`,
      `  executables=${executables.status}; pinned=${executables.pinnedFields.length}`,
      ...executables.missing.map((entry) => `  ${entry.problem} ${entry.field}: ${entry.path}`),
    ];
    if (executables.missing.length > 0 || executables.pinnedFields.length > 0)
      lines.push(
        "  Run `lervo upgrade` in this repository to point these fields at the host's stable CLI.",
      );
    return lines.join("\n");
  });
  return `Repository Node fleet: ${report.status}\n${instances.join("\n")}\n`;
}
