import type { KnowledgeMaterializationSettlement } from "@lervo/repository-knowledge";

import { CommandFailure } from "./command-error-output.js";
import {
  heldKnowledgeEffectReason,
  holdEffect,
  releaseHeldEffects,
  type HeldEffectReason,
} from "./held-effect-debt.js";
import type { CliServices } from "./types.js";
import type { UpgradeReceipt } from "./upgrade-format.js";
import {
  applyKnowledgeStage,
  inspectKnowledge,
  type KnowledgeStage,
} from "./upgrade-stage-inspection.js";

const knowledgeRefusedByMarker = (stage: KnowledgeStage): boolean =>
  stage.reason === "knowledge_recovery_required";

/**
 * ADR-0561: a cross-check that disagreed or could not run, a commit that is not possible, or a
 * touched user path with uncommitted work holds the stage as Lervo debt; nothing was applied.
 */
function heldCrossCheck(error: unknown): HeldEffectReason | null {
  return error instanceof CommandFailure ? heldKnowledgeEffectReason(error.code) : null;
}

/**
 * The knowledge stages of one upgrade apply, at most `maximumStages` in a row (ADR-0214,
 * ADR-0561). A reviewed plan is cross-checked through `lervo migrate knowledge --apply`; one the
 * check rejects or could not run is held as Lervo debt and ends the loop, so later stages still
 * apply. Only the plan the loop stopped at stays held. ADR-0577: each write first confirms the
 * resident exclusion; the last inspected stage is returned for the lint decision.
 */
export async function applyKnowledgeStages(input: {
  repositoryRoot: string;
  maximumStages: number;
  materialization: KnowledgeMaterializationSettlement;
  services: Partial<Pick<CliServices, "crossCheckPlan">>;
  confirmExclusion: () => Promise<void>;
  lap: () => void;
}): Promise<
  Pick<UpgradeReceipt, "appliedStages" | "skippedStages" | "notices"> & {
    lastStage: KnowledgeStage | null;
  }
> {
  const { repositoryRoot, materialization, services } = input;
  const appliedStages: UpgradeReceipt["appliedStages"] = [];
  const skippedStages: UpgradeReceipt["skippedStages"] = [];
  const notices: UpgradeReceipt["notices"] = [];
  let lastStage: KnowledgeStage | null = null;
  for (let index = 0; index < input.maximumStages; index += 1) {
    // A marker refusal happens before any write, so inspecting and applying again is safe.
    let held: { planId: string; outcome: HeldEffectReason } | null = null;
    const stage = await materialization.run(async () => {
      const inspected = await inspectKnowledge(repositoryRoot);
      if (inspected.disposition !== "safe_apply") return inspected;
      await input.confirmExclusion();
      try {
        const { undo } = await applyKnowledgeStage(repositoryRoot, inspected, services);
        if (undo !== null)
          notices.push({
            stage: "knowledge",
            summary: `Applied the cross-checked ${inspected.planKind} plan ${inspected.planId}.`,
            undo,
          });
      } catch (error) {
        const outcome = heldCrossCheck(error);
        if (outcome === null) throw error;
        held = { planId: inspected.planId ?? inspected.planKind, outcome };
      }
      return inspected;
    }, knowledgeRefusedByMarker);
    input.lap();
    lastStage = stage;
    if (held !== null) {
      const { planId, outcome } = held as { planId: string; outcome: HeldEffectReason };
      // A rejected exact plan regenerates identically, so it is held at once (ADR-0561).
      await holdEffect({
        repositoryRoot,
        effect: "upgrade_knowledge",
        subject: planId,
        reasonCode: outcome,
      });
      skippedStages.push({
        stage: "knowledge",
        reason: outcome === "cross_check_disagreement_repeated" ? "cross_check_disagreed" : outcome,
      });
      break;
    }
    if (stage.disposition !== "safe_apply") break;
    appliedStages.push(stage.planKind);
    if (index === input.maximumStages - 1)
      throw new Error("The bounded knowledge upgrade did not converge within 16 stages.");
  }
  // Only the plan the stage last stopped at stays held; an applied or changed plan releases it.
  await releaseHeldEffects(
    repositoryRoot,
    "upgrade_knowledge",
    (item) => item.subject === lastStage?.planId,
  );

  return { appliedStages, skippedStages, notices, lastStage };
}
