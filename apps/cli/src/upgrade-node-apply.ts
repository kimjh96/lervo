import { createHash } from "node:crypto";

import {
  prepareNodeConfigExecutables,
  nodeConfigExecutablesPending,
} from "./node-config-executable-upgrade.js";
import { applyNodeFleetOnboarding, type NodeFleetApplyReceipt } from "./node-fleet-apply.js";
import type { DescribeInstalledNodeLauncher } from "./node-fleet-runtime-material.js";
import type { NodeUpgradeInspection } from "./upgrade-node.js";

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/** The onboarding receipt, or null when nothing in the deployment or its configuration changed. */
export async function applyRegisteredNodeUpgrade(
  inspection: NodeUpgradeInspection,
  describeLauncher?: DescribeInstalledNodeLauncher,
): Promise<NodeFleetApplyReceipt | null> {
  if (
    inspection.plan === null ||
    inspection.configPath === null ||
    inspection.stage.configPathDigest !== sha256(inspection.configPath)
  )
    throw new Error("The registered Node upgrade inputs could not be revalidated.");
  // ADR-0489: the migrated configuration replaces the file only inside the guarded service
  // transition, while the Node is stopped, so the work admission binding moves with it.
  const executables = inspection.configExecutables?.stage;
  const prepared =
    executables !== undefined && nodeConfigExecutablesPending(executables)
      ? await prepareNodeConfigExecutables(inspection.configPath, executables)
      : null;
  try {
    if (inspection.replaceDeployment === false && prepared?.configurationSource == null)
      return null;
    return await applyNodeFleetOnboarding({
      plan: inspection.plan,
      configPath: inspection.configPath,
      allowHubUnavailableReadiness: true,
      ...(describeLauncher === undefined ? {} : { describeLauncher }),
      ...(inspection.transitionLegacy === true ? { transitionLegacy: true } : {}),
      ...(inspection.pathDirectories === undefined
        ? {}
        : { pathDirectories: inspection.pathDirectories }),
      ...(prepared?.configurationSource == null
        ? {}
        : { configurationSource: prepared.configurationSource }),
    });
  } finally {
    await prepared?.cleanup();
  }
}
