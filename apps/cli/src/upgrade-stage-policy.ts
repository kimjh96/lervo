/**
 * ADR-0561: no stage waits for the owner. `safe_apply` stages apply on `--apply` after their own
 * cross-check, backup, or transaction; `lervo_debt` is a stage Lervo holds itself, with its
 * reason, and never owner work.
 */
export type StageDisposition = "current" | "safe_apply" | "deferred" | "lervo_debt" | "blocked";

export type UpgradeStageName =
  | "capabilities"
  | "workforce"
  | "terminal_integration"
  | "knowledge"
  | "node"
  | "event_writer"
  | "host_service"
  | "replica_service"
  | "event_writer_backup_retention"
  | "runtime_retention";

/**
 * - `applied_first`: the dependent is inspected only after the prerequisite
 *   has applied, because the prerequisite changes the dependent's inputs.
 * - `not_blocked`: the dependent may apply only when the prerequisite is not
 *   blocked after its own application in the same run.
 * - `ordered_after`: the dependent runs after the prerequisite in apply order,
 *   but a blocked or held prerequisite never defers it.
 */
export type UpgradeStageRequirement = "applied_first" | "not_blocked" | "ordered_after";

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
  runtime_retention: [],
  capabilities: [],
  workforce: [{ stage: "capabilities", requires: "applied_first" }],
  terminal_integration: [],
  knowledge: [{ stage: "capabilities", requires: "applied_first" }],
  // ADR-0546: Node readiness judges regression, not knowledge currency, so a blocked knowledge
  // stage must not strand the Node runtime and the event writer behind it on an old release.
  node: [{ stage: "knowledge", requires: "ordered_after" }],
  // ADR-0470: the generated hook runtime is a local event reader, and a Node reader must be
  // upgraded before its health can prove it reads the new schema. The stage's own hook reader
  // preflight decides when the hook runtime is not current yet.
  event_writer: [
    { stage: "terminal_integration", requires: "applied_first" },
    { stage: "node", requires: "applied_first" },
  ],
  host_service: [],
  // ADR-0483: an activated Node runtime moves `current` itself; this stage repairs the pointer
  // and refreshes the replica service after every other stage.
  replica_service: [{ stage: "node", requires: "applied_first" }],
  // ADR-0651: an activation in this run writes the next backup first; the apply plans again.
  event_writer_backup_retention: [{ stage: "event_writer", requires: "ordered_after" }],
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
  "event_writer_backup_retention",
  "runtime_retention",
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
    if (dependency.requires === "ordered_after") continue;
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
): "ready" | "current" | "lervo_debt" | "blocked" {
  if (dispositions.includes("blocked")) return "blocked";
  if (dispositions.includes("safe_apply")) return "ready";
  if (dispositions.includes("lervo_debt")) return "lervo_debt";
  return "current";
}

/** Stages an apply of this plan would change, in apply order. */
export function applicableUpgradeStages(
  dispositions: Record<UpgradeStageName, StageDisposition>,
): UpgradeStageName[] {
  return upgradeStageApplyOrder.filter((stage) => dispositions[stage] === "safe_apply");
}

/**
 * ADR-0589: why an apply skips knowledge lint, or null when lint runs. Lint reports what the run
 * left in repository content, so it is skipped only when the run has applied no stage yet and its
 * own knowledge inspection found the stage current with nothing left to drain. A blocked,
 * pending, or deferred knowledge stage is always linted (ADR-0547), and so is a `current` stage
 * whose debt the background resident still owns (`background_owned`), because its content issues
 * are what the receipt warns about.
 */
export function knowledgeLintSkipReason(
  appliedStages: readonly string[],
  knowledge: { disposition: StageDisposition; reason: string } | null,
): "knowledge_current_nothing_applied" | null {
  return appliedStages.length === 0 &&
    knowledge?.disposition === "current" &&
    knowledge.reason !== "background_owned"
    ? "knowledge_current_nothing_applied"
    : null;
}
