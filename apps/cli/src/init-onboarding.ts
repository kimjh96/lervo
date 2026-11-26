import { listAgents, registerAgent, type WorkforceEvent } from "@lervo/agent-workforce";
import { applyCapabilityMigration, createCapabilityMigrationPlan } from "@lervo/capabilities";
import { openProjectStorage } from "@lervo/project-storage";

import { heldKnowledgeEffectReason, holdEffect } from "./held-effect-debt.js";
import { knowledgeBackgroundOwner } from "./knowledge-background-owner.js";
import { runKnowledgeMigration } from "./knowledge-command.js";
import { recordWorkforceEvent } from "./workforce-events.js";

export interface OnboardingResult {
  /**
   * `background_owned`: ADR-0469 continuity owns the remaining normalization debt. `lervo_debt`
   * (ADR-0561): a stage Lervo could not apply yet, held as its own debt with `debtReason` and
   * retried by `lervo upgrade --apply`; nothing waits for the owner.
   */
  status: "lervo_debt" | "provider_ready" | "background_owned" | "blocked";
  initialAgentId: string;
  completedStages: string[];
  pendingStage: string | null;
  pendingPlan: Record<string, unknown> | null;
  debtReason?: string;
}

/** The error code a failed `--json` knowledge command reports, if any. */
function commandErrorCode(output: string[]): string | null {
  try {
    const value = JSON.parse(output.join("")) as { error?: { code?: unknown } };
    return typeof value.error?.code === "string" ? value.error.code : null;
  } catch {
    return null;
  }
}

/**
 * `lervo init --onboard`: registers the initial agent, packages repository skills, and applies the
 * knowledge stages in order. A reviewed plan is cross-checked by `--apply`; a stage Lervo cannot
 * apply yet is Lervo debt (ADR-0561), never an owner decision.
 */
export async function bootstrapOnboarding(root: string): Promise<OnboardingResult> {
  let agents = await listAgents(root);
  if (agents.length === 0) {
    const storage = await openProjectStorage(root);
    try {
      const agent = await registerAgent({
        repositoryRoot: root,
        roleId: "developer",
        provider: "any",
        responsibilityPaths: ["*"],
        // The project's first developer is the team's (ADR-0643).
        origin: "team",
        recordEvent: (event: WorkforceEvent) => recordWorkforceEvent(storage, event),
      });
      agents = [agent];
    } finally {
      await storage.close();
    }
  }
  const initialAgent =
    agents.find((agent) => agent.status === "active" && agent.roleId === "developer") ??
    agents.find((agent) => agent.status === "active");
  if (initialAgent === undefined)
    throw new Error("Onboarding requires one active repository agent.");
  const completedStages = ["project_identity", "initial_agent"];
  const capabilityPlan = await createCapabilityMigrationPlan(root);
  if (capabilityPlan.status === "ready") await applyCapabilityMigration(capabilityPlan);
  completedStages.push("capability_repository_migration");
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runKnowledgeMigration({
      args: ["--root", root, "--json"],
      io: {
        cwd: root,
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      },
      mode: "migrate",
    });
    let plan: Record<string, unknown>;
    try {
      plan = JSON.parse(stdout.join("")) as Record<string, unknown>;
    } catch {
      return {
        status: "blocked",
        initialAgentId: initialAgent.agentId,
        completedStages,
        pendingStage: "knowledge",
        pendingPlan: {
          failure: stderr.join("").trim() || "knowledge_plan_unavailable",
          exitCode: code,
        },
      };
    }
    // ADR-0561: a reviewed plan applies like a ready one; `--apply` cross-checks it first in a fresh
    // no-capability session, and a disagreement or a missing reviewer holds it as Lervo debt.
    if (
      (plan.status === "ready" || plan.status === "review_required") &&
      typeof plan.planId === "string"
    ) {
      const applyOutput: string[] = [];
      const applyError: string[] = [];
      const applied = await runKnowledgeMigration({
        args: ["--root", root, "--apply", plan.planId, "--json"],
        io: {
          cwd: root,
          stdout: (message) => applyOutput.push(message),
          stderr: (message) => applyError.push(message),
        },
        mode: "migrate",
      });
      // ADR-0561: a refused cross-check, or an effect that cannot land as its undo commit.
      const reasonCode = heldKnowledgeEffectReason(
        applied === 0 ? null : commandErrorCode(applyOutput),
      );
      if (reasonCode !== null) {
        await holdEffect({
          repositoryRoot: root,
          effect: "upgrade_knowledge",
          subject: plan.planId,
          reasonCode,
        });
        return {
          status: "lervo_debt",
          initialAgentId: initialAgent.agentId,
          completedStages,
          pendingStage: String(plan.planKind ?? "knowledge"),
          pendingPlan: { planId: plan.planId },
          debtReason: reasonCode,
        };
      }
      if (applied !== 0)
        return {
          status: "blocked",
          initialAgentId: initialAgent.agentId,
          completedStages,
          pendingStage: "knowledge",
          pendingPlan: { failure: applyError.join("").trim() || "safe_stage_apply_failed" },
        };
      completedStages.push(String(plan.planKind ?? "knowledge_materialization"));
      continue;
    }
    if (plan.status === "current") {
      completedStages.push(String(plan.planKind ?? "knowledge"));
      return {
        status: "provider_ready",
        initialAgentId: initialAgent.agentId,
        completedStages,
        pendingStage: null,
        pendingPlan: null,
      };
    }
    // ADR-0469: with a delegation or host continuity policy, the resident owns provider selection.
    if (plan.status === "provider_required" && (await knowledgeBackgroundOwner(root)) !== null)
      return {
        status: "background_owned",
        initialAgentId: initialAgent.agentId,
        completedStages: [...completedStages, "knowledge_continuity"],
        pendingStage: null,
        pendingPlan: null,
      };
    const pendingStage = String(
      plan.planKind ??
        (plan.status === "provider_required" ? "document_normalization" : "provider_integration"),
    );
    // A provider-required stage waits for a provider or delegation Lervo admits itself.
    return {
      status: plan.status === "blocked" ? "blocked" : "lervo_debt",
      initialAgentId: initialAgent.agentId,
      completedStages,
      pendingStage,
      pendingPlan: plan,
      ...(plan.status === "blocked"
        ? {}
        : {
            debtReason:
              plan.status === "provider_required"
                ? "normalization_awaits_background_owner"
                : String(plan.status),
          }),
    };
  }
  return {
    status: "blocked",
    initialAgentId: initialAgent.agentId,
    completedStages,
    pendingStage: "onboarding_iteration_limit",
    pendingPlan: null,
  };
}
