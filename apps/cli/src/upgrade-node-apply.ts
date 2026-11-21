import { createHash } from "node:crypto";

import {
  prepareNodeConfigExecutables,
  nodeConfigExecutablesPending,
} from "./node-config-executable-upgrade.js";
import { applyNodeFleetOnboarding, type NodeFleetApplyReceipt } from "./node-fleet-apply.js";
import type { NodeFleetApplyError } from "./node-fleet-apply-contract.js";
import {
  clearUpgradeNodeFailure,
  recordUpgradeNodeFailure,
} from "./upgrade-node-failure-record.js";
import {
  blockersWithoutBaselineEvidence,
  witnessRestoredPredecessor,
} from "./node-fleet-readiness-witness.js";
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
    const { plan, configPath } = inspection;
    const apply = () =>
      applyNodeFleetOnboarding({
        plan,
        configPath,
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
    const appliedAt = new Date();
    try {
      const receipt = await settle(apply, appliedAt, plan.desired.healthPath);
      await clearUpgradeNodeFailure(plan.desired.repositoryRoot);
      return receipt;
    } catch (error) {
      // ADR-0575: this CLI's own record of why; the follower may still run an older CLI.
      await recordUpgradeNodeFailure(
        plan.desired.repositoryRoot,
        plan.desired.runtimeVersion,
        error,
      );
      throw error;
    }
  } finally {
    await prepared?.cleanup();
  }

  /** One replacement, or two when the restored predecessor proves the blockers predate it. */
  async function settle(
    apply: () => Promise<NodeFleetApplyReceipt>,
    appliedAt: Date,
    healthPath: string,
  ): Promise<NodeFleetApplyReceipt> {
    try {
      return await apply();
    } catch (error) {
      // ADR-0475: a blocker without baseline evidence is judged by the restored predecessor. Only
      // when it settles every such component exactly as the replacement did does the condition
      // predate this release; then one more replacement carries it from that evidence.
      const blockers = blockersWithoutBaselineEvidence(error);
      if (blockers === null) throw error;
      const witnessed = await witnessRestoredPredecessor({
        path: healthPath,
        notBefore: appliedAt,
        replacementProcessId:
          (error as NodeFleetApplyError).details.readiness?.lastProcessId ?? null,
        components: blockers.map((blocker) => blocker.component),
        ports: {},
      });
      if (
        witnessed === null ||
        blockers.some((blocker) => witnessed[blocker.component] !== blocker.observed)
      )
        throw error;
      const receipt = await apply();
      return {
        ...receipt,
        readiness: {
          ...receipt.readiness,
          witnessedConditions: blockers.map((blocker) => ({
            component: blocker.component,
            state: blocker.observed,
          })),
        },
      };
    }
  }
}
