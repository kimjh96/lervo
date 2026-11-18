import { createWorkforceRoleBindingMigrationPlan } from "@lervo/agent-workforce";
import { readWorkerProviderSelection } from "@lervo/repository-knowledge-runtime";
import type {
  RepositoryLayoutCapacityFinding,
  RepositoryLayoutDeferredDocument,
  RepositoryLayoutMigrationPlan,
  DocumentRouteDeferralResolution,
} from "@lervo/repository-knowledge";

import { CommandFailure } from "./command-error-output.js";
import { layoutDeferrals } from "./upgrade-deferred-documents.js";
import { heldUpgradeKnowledgeReason } from "./held-effect-debt.js";
import { knowledgeBackgroundOwner } from "./knowledge-background-owner.js";
import { MAXIMUM_LAYOUT_CAPACITY_ITEMS } from "./layout-capacity-lines.js";
import { runKnowledgeCommand, runKnowledgeMigration } from "./knowledge-command.js";
import type { CliIo, CliServices } from "./types.js";
import type { StageDisposition } from "./upgrade-stage-policy.js";

const maximumReportedBlockers = 64;

export interface UpgradeStageBlocker {
  code: string;
  path?: string;
  message?: string;
  issues?: unknown[];
}

export interface KnowledgeStage {
  disposition: StageDisposition;
  planKind: string;
  planId: string | null;
  status: string;
  reason: string;
  blockers: UpgradeStageBlocker[];
  /**
   * ADR-0469: normalization debt the background resident drains under its delegation or the
   * host continuity policy; present only with reason `background_owned`.
   */
  backgroundDebt?: { owner: "delegation" | "continuity_policy"; pendingDocuments: number };
  /**
   * ADR-0476: documents waiting for a semantic route. They never decide the disposition; each
   * is reported so the owner sees what the background resident will classify.
   */
  deferredDocuments?: Array<
    Pick<RepositoryLayoutDeferredDocument, "path" | "reason" | "subject"> & {
      resolution: DocumentRouteDeferralResolution;
    }
  >;
  /** ADR-0583: directories over document capacity, with their counts and limits. */
  layoutCapacity?: RepositoryLayoutCapacityFinding[];
  /** The full number of directories over capacity; `layoutCapacity` lists at most 16. */
  layoutCapacityCount?: number;
}

export { inspectTerminalIntegration } from "./upgrade-terminal-inspection.js";

export interface TerminalIntegrationStage {
  disposition: StageDisposition;
  planId: string | null;
  status: string;
  reason: string;
  blockers: UpgradeStageBlocker[];
}

export interface WorkforceStage {
  disposition: StageDisposition;
  planId: string | null;
  staleAgentCount: number;
  staleAssignmentCount: number;
  status: string;
  reason: string;
  /** Repository-defined roles the stage refreshes; the role source in Git is their undo. */
  repositoryRoleRefreshes: Array<{
    roleId: string;
    roleVersion: string;
    roleContractHash: string;
    staleAgentCount: number;
    staleAssignmentCount: number;
  }>;
}

interface CapturedCommand {
  code: number;
  value: Record<string, unknown> | null;
  error: string;
}

async function capture(run: (io: CliIo) => Promise<number>, cwd: string): Promise<CapturedCommand> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run({
    cwd,
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
  });
  const text = stdout.join("").trim();
  let value: Record<string, unknown> | null = null;
  if (text !== "") {
    try {
      value = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return {
        code: 1,
        value: null,
        error: stderr.join("").trim() || "The command returned invalid JSON.",
      };
    }
  }
  return { code, value, error: stderr.join("").trim() };
}

/** Keeps a captured command's error code, such as a materialization marker refusal. */
function capturedFailure(result: CapturedCommand, fallback: string): Error {
  const envelope = record(result.value?.error);
  const message =
    (typeof envelope?.message === "string" ? envelope.message : null) ?? (result.error || fallback);
  return typeof envelope?.code === "string"
    ? new CommandFailure(envelope.code, message)
    : new Error(message);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function blocker(value: unknown): UpgradeStageBlocker | null {
  const item = record(value);
  if (item === null || typeof item.code !== "string") return null;
  return {
    code: item.code,
    ...(typeof item.path === "string" ? { path: item.path } : {}),
    ...(typeof item.message === "string" ? { message: item.message } : {}),
    ...(Array.isArray(item.issues) && item.issues.length > 0 ? { issues: item.issues } : {}),
  };
}

/** Whether a printed plan writes user-owned bytes: a user file, or a moved file it rewrites. */
function editsUserOwnedContent(operations: unknown): boolean {
  return (
    Array.isArray(operations) &&
    operations.some((operation) => {
      const item = record(operation);
      return item?.ownership === "user" || item?.action === "move_update";
    })
  );
}

/** Extracts the exact blockers from any knowledge sub-plan or error envelope. */
function knowledgePlanBlockers(value: Record<string, unknown>): UpgradeStageBlocker[] {
  const error = blocker(value.error);
  const declared = Array.isArray(value.blockers) ? value.blockers.map(blocker) : [];
  const conflicts = Array.isArray(value.operations)
    ? value.operations.flatMap((operation) => {
        const item = record(operation);
        return item?.action === "conflict" && typeof item.path === "string"
          ? [
              {
                code: "conflict",
                path: item.path,
                ...(typeof item.reason === "string" ? { message: item.reason } : {}),
              },
            ]
          : [];
      })
    : [];
  return [...(error === null ? [] : [error]), ...declared, ...conflicts]
    .filter((item): item is UpgradeStageBlocker => item !== null)
    .slice(0, maximumReportedBlockers);
}

export async function inspectKnowledge(root: string): Promise<KnowledgeStage> {
  let planned: RepositoryLayoutMigrationPlan | null = null;
  const result = await capture(
    (io) =>
      runKnowledgeMigration({
        args: ["--root", root, "--integration-head", "--json"],
        io,
        mode: "migrate",
        observeLayout: (layout) => {
          planned = layout;
        },
      }),
    root,
  );
  const stage = await knowledgeDisposition(root, result);
  const deferred = await layoutDeferrals(root, result.value, planned);
  const capacity = (planned as RepositoryLayoutMigrationPlan | null)?.layoutCapacity ?? [];
  return {
    ...stage,
    ...(deferred.length === 0
      ? {}
      : { deferredDocuments: deferred.slice(0, maximumReportedBlockers) }),
    ...(capacity.length === 0
      ? {}
      : {
          layoutCapacity: capacity.slice(0, MAXIMUM_LAYOUT_CAPACITY_ITEMS),
          layoutCapacityCount: capacity.length,
        }),
  };
}

async function knowledgeDisposition(
  root: string,
  result: CapturedCommand,
): Promise<KnowledgeStage> {
  if (result.value === null) {
    return {
      disposition: "blocked",
      planKind: "knowledge_migration",
      planId: null,
      status: "failed",
      reason: result.error || "knowledge_plan_unavailable",
      blockers: [{ code: "knowledge_plan_unavailable", message: result.error }],
    };
  }
  const envelope = record(result.value.error);
  const status = typeof result.value.status === "string" ? result.value.status : "unknown";
  const planKind =
    typeof result.value.planKind === "string" ? result.value.planKind : "knowledge_materialization";
  const planId = typeof result.value.planId === "string" ? result.value.planId : null;
  const operations = Array.isArray(result.value.operations)
    ? (result.value.operations as Array<{ action?: unknown }>)
    : null;
  // Terminal integration is the separately planned terminal_integration stage.
  // Reaching it means the knowledge stages before it are current.
  if (
    envelope === null &&
    (planKind === "terminal_integration" ||
      (status !== "blocked" &&
        (status === "current" ||
          (operations !== null && operations.every((item) => item.action === "unchanged")))))
  ) {
    return {
      disposition: "current",
      planKind,
      planId,
      status,
      reason: "canonical_sources_current",
      blockers: [],
    };
  }
  if (envelope === null && status === "ready" && planId !== null) {
    return {
      disposition: "safe_apply",
      planKind,
      planId,
      status,
      reason: "generated_only_exact_plan",
      blockers: [],
    };
  }
  // Provider selection and a reviewed lifecycle plan are background work whenever a background
  // owner will normalize the debt or cross-check and apply the plan (ADR-0561). Without one,
  // upgrade cross-checks and applies the reviewed plan itself.
  const backgroundOwner =
    envelope === null && (status === "provider_required" || status === "review_required")
      ? await knowledgeBackgroundOwner(root)
      : null;
  if (backgroundOwner !== null) {
    return {
      disposition: "current",
      planKind,
      planId,
      status,
      reason: "background_owned",
      blockers: [],
      backgroundDebt: {
        owner: backgroundOwner,
        pendingDocuments: Array.isArray(result.value.pendingDocuments)
          ? result.value.pendingDocuments.length
          : Array.isArray(result.value.moves)
            ? result.value.moves.length
            : 0,
      },
    };
  }
  if (envelope === null && status === "review_required" && planId !== null) {
    // AGENTS.md invariant 5: without the owner's delegation, Lervo never rewrites user-owned bytes
    // on its own. Such a plan waits for an owner command; an upgrade never applies it.
    if (editsUserOwnedContent(result.value.operations))
      return {
        disposition: "lervo_debt",
        planKind,
        planId,
        status,
        reason: "user_owned_content",
        blockers: [],
      };
    const heldReason = await heldUpgradeKnowledgeReason(
      root,
      planId,
      async () => (await readWorkerProviderSelection(root)) !== null,
    );
    return {
      disposition: heldReason === null ? "safe_apply" : "lervo_debt",
      planKind,
      planId,
      status,
      reason: heldReason ?? "cross_checked_apply",
      blockers: [],
    };
  }
  if (
    envelope === null &&
    ["review_required", "provider_required", "action_required"].includes(status)
  ) {
    return {
      disposition: "lervo_debt",
      planKind,
      planId,
      status,
      reason: status === "provider_required" ? "normalization_awaits_background_owner" : status,
      blockers: [],
    };
  }
  const blockers = knowledgePlanBlockers(result.value);
  return {
    disposition: "blocked",
    planKind,
    planId,
    status,
    reason:
      (typeof envelope?.code === "string" ? envelope.code : null) ??
      blockers[0]?.code ??
      (result.error || status || `knowledge_plan_failed_${result.code}`),
    blockers,
  };
}

export async function inspectWorkforce(root: string): Promise<WorkforceStage> {
  const plan = await createWorkforceRoleBindingMigrationPlan(root);
  return {
    disposition:
      plan.status === "ready" ? "safe_apply" : plan.status === "blocked" ? "blocked" : "current",
    planId: plan.planId,
    staleAgentCount: plan.staleAgentCount,
    staleAssignmentCount: plan.staleAssignmentCount,
    status: plan.status,
    reason: plan.reason,
    repositoryRoleRefreshes: plan.repositoryRoleRefreshes,
  };
}

/**
 * Applies one knowledge stage through `lervo migrate knowledge --apply`. A reviewed plan is
 * cross-checked there first; the undo command its effect commit carries is returned.
 */
export async function applyKnowledgeStage(
  root: string,
  stage: KnowledgeStage,
  services: Partial<Pick<CliServices, "crossCheckPlan">> = {},
): Promise<{ undo: string | null }> {
  if (stage.planId === null) throw new Error("An applicable knowledge stage has no exact plan ID.");
  const result = await capture(
    (io) =>
      runKnowledgeMigration({
        args: ["--root", root, "--integration-head", "--apply", stage.planId!, "--json"],
        io,
        mode: "migrate",
        services,
      }),
    root,
  );
  if (result.code !== 0)
    throw capturedFailure(result, "The exact knowledge migration stage failed.");
  const notice = record(result.value?.notice);
  return { undo: typeof notice?.undo === "string" ? notice.undo : null };
}

/**
 * Pre-existing repository content errors stay visible in the receipt and never stop the
 * independent Node, event-writer, and service stages (ordered-stage convergence). Only a lint
 * command that could not produce a report stops the apply.
 */
export async function lintKnowledge(root: string): Promise<{ valid: boolean; issueCount: number }> {
  const result = await capture(
    (io) => runKnowledgeCommand(["lint", "--root", root, "--json"], io),
    root,
  );
  if (typeof result.value?.valid !== "boolean" || !Array.isArray(result.value?.issues))
    throw capturedFailure(result, "Repository knowledge lint could not produce a report.");
  return { valid: result.code === 0 && result.value.valid, issueCount: result.value.issues.length };
}
