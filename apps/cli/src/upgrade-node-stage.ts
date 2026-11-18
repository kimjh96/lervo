import { createHash } from "node:crypto";

import type { NodeFleetOnboardingPlan } from "@lervo/repository-registry";

import type {
  NodeConfigExecutablesInspection,
  NodeConfigExecutablesStage,
} from "./node-config-executable-upgrade.js";

export interface NodeUpgradeStage {
  disposition: "current" | "safe_apply" | "lervo_debt" | "blocked";
  registered: boolean;
  planId: string | null;
  runtimeVersion: { current: string | null; desired: string };
  runtimeBuildHash: string | null;
  configPathDigest: string | null;
  serviceTargetHash: string | null;
  /** ADR-0470: hash of the definition this upgrade renders, including tool directories. */
  desiredServiceHash?: string | null;
  /** ADR-0488: the host CLI pointer and the configuration's version-specific paths. */
  configExecutables?: NodeConfigExecutablesStage;
  reason: string;
  blockers?: Array<{ code: string; message: string }>;
}

export interface NodeUpgradeInspection {
  stage: NodeUpgradeStage;
  plan: NodeFleetOnboardingPlan | null;
  configPath: string | null;
  /** The resolved service PATH tool directories the apply renders. */
  pathDirectories?: string[];
  configExecutables?: NodeConfigExecutablesInspection;
  /** False when only the CLI pointer or configuration changes and the deployment is current. */
  replaceDeployment?: boolean;
  /**
   * ADR-0561: a legacy singleton is transitioned inside the same guarded apply. Its definition is
   * archived as the backup after the repository Node verifies ready.
   */
  transitionLegacy?: boolean;
}

export function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/** One Node stage observation; the configuration path is reported only as its digest. */
export function stage(input: {
  disposition: NodeUpgradeStage["disposition"];
  registered: boolean;
  planId: string | null;
  currentVersion: string | null;
  desiredVersion: string;
  runtimeBuildHash?: string | null;
  configPath?: string | null;
  serviceTargetHash?: string | null;
  reason: string;
}): NodeUpgradeStage {
  return {
    disposition: input.disposition,
    registered: input.registered,
    planId: input.planId,
    runtimeVersion: { current: input.currentVersion, desired: input.desiredVersion },
    runtimeBuildHash: input.runtimeBuildHash ?? null,
    configPathDigest:
      input.configPath === undefined || input.configPath === null ? null : sha256(input.configPath),
    serviceTargetHash: input.serviceTargetHash ?? null,
    reason: input.reason,
  };
}
