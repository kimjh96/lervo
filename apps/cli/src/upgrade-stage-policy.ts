export type StageDisposition =
  "current" | "safe_apply" | "deferred" | "pending_authority" | "blocked";

export type UpgradeStageName =
  | "capabilities"
  | "workforce"
  | "terminal_integration"
  | "knowledge"
  | "node"
  | "event_writer"
  | "host_service"
  | "replica_service";

/**
 * - `applied_first`: the dependent is inspected only after the prerequisite
 *   has applied, because the prerequisite changes the dependent's inputs.
 * - `not_blocked`: the dependent may apply only when the prerequisite is not
 *   blocked after its own application in the same run.
 */
export type UpgradeStageRequirement = "applied_first" | "not_blocked";

export interface UpgradeStageDependency {
  stage: UpgradeStageName;
  requires: UpgradeStageRequirement;
}

/**
 * Explicit stage ordering. A stage without a dependency on a blocked stage
 * still plans and applies; one blocked stage never prevents an independent
 * generated-only stage from reaching current.
 */
export const upgradeStageDependencies: Readonly<
  Record<UpgradeStageName, readonly UpgradeStageDependency[]>
> = {
  capabilities: [],
  workforce: [{ stage: "capabilities", requires: "applied_first" }],
  terminal_integration: [],
  knowledge: [{ stage: "capabilities", requires: "applied_first" }],
  node: [{ stage: "knowledge", requires: "not_blocked" }],
  // ADR-0470: the generated hook runtime is a local event reader, and a Node reader must be
  // upgraded before its health can prove it reads the new schema. The stage's own hook reader
  // preflight decides when the hook runtime still awaits an owner approval.
  event_writer: [
    { stage: "terminal_integration", requires: "applied_first" },
    { stage: "node", requires: "applied_first" },
  ],
  host_service: [],
  // ADR-0483: an activated Node runtime moves `current` itself; this stage repairs the pointer
  // and refreshes the replica service after every other stage.
  replica_service: [{ stage: "node", requires: "applied_first" }],
};

export const upgradeStageApplyOrder: readonly UpgradeStageName[] = [
  "capabilities",
  "workforce",
  "terminal_integration",
  "knowledge",
  "node",
  "event_writer",
  "host_service",
  "replica_service",
];

/**
 * Returns the prerequisite that defers `stage`, or null when the stage may be
 * planned from its own inspection.
 */
export function deferringPrerequisite(
  stage: UpgradeStageName,
  dispositions: Partial<Record<UpgradeStageName, StageDisposition>>,
): UpgradeStageDependency | null {
  for (const dependency of upgradeStageDependencies[stage]) {
    const disposition = dispositions[dependency.stage];
    if (dependency.requires === "applied_first" && disposition === "safe_apply") return dependency;
    if (disposition === "blocked") return dependency;
  }
  return null;
}

export function deferralReason(dependency: UpgradeStageDependency): string {
  return dependency.requires === "applied_first"
    ? `${dependency.stage}_must_apply_first`
    : `${dependency.stage}_stage_blocked`;
}

export function overallUpgradeStatus(
  dispositions: readonly StageDisposition[],
): "ready" | "current" | "pending_authority" | "blocked" {
  if (dispositions.includes("blocked")) return "blocked";
  if (dispositions.includes("safe_apply")) return "ready";
  if (dispositions.includes("pending_authority")) return "pending_authority";
  return "current";
}

/** Stages an exact apply of this plan would change, in apply order. */
export function applicableUpgradeStages(
  dispositions: Record<UpgradeStageName, StageDisposition>,
  hasDisplayedRoleApprovals: boolean,
): UpgradeStageName[] {
  return upgradeStageApplyOrder.filter(
    (stage) =>
      dispositions[stage] === "safe_apply" ||
      (stage === "workforce" &&
        dispositions.workforce === "pending_authority" &&
        hasDisplayedRoleApprovals),
  );
}
