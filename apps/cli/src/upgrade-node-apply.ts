import { createHash } from "node:crypto";

import {
  prepareNodeConfigExecutables,
  nodeConfigExecutablesPending,
} from "./node-config-executable-upgrade.js";
import { applyNodeFleetOnboarding } from "./node-fleet-apply.js";
import type { NodeUpgradeInspection } from "./upgrade-node.js";

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export async function applyRegisteredNodeUpgrade(inspection: NodeUpgradeInspection): Promise<void> {
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
    if (inspection.replaceDeployment === false && prepared?.configurationSource == null) return;
    await applyNodeFleetOnboarding({
      plan: inspection.plan,
      configPath: inspection.configPath,
      allowHubUnavailableReadiness: true,
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
