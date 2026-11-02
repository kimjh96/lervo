import { createWorkforceRoleBindingMigrationPlan } from "@lervo/agent-workforce";
import {
  createRepositoryLayoutMigrationPlan,
  type RepositoryLayoutDeferredDocument,
  type DocumentRouteDeferralResolution,
} from "@lervo/repository-knowledge";

import { CommandFailure } from "./command-error-output.js";
import { deferredDocuments } from "./upgrade-deferred-documents.js";
import { knowledgeBackgroundOwner } from "./knowledge-background-owner.js";
import { pendingLayoutDecision } from "./knowledge-layout-decision.js";
import { runKnowledgeCommand, runKnowledgeMigration } from "./knowledge-command.js";
import {
  planTerminalIntegrationStage,
  type PreparedTerminalIntegration,
} from "./terminal-integration-stage.js";
import type { CliIo } from "./types.js";
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
  /** ADR-0559: the one owner decision a layout plan asks for, with its two commands. */
  layoutDecision?: { decisionId: string; summary: string; accept: string; decline: string };
}

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
  requiredApprovals: Array<{
    operationId: string;
    approvalHash: string;
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

/** The layout plan's deferrals; an unavailable layout reports none rather than failing the stage. */
async function layoutDeferrals(
  root: string,
  value: Record<string, unknown> | null,
): Promise<NonNullable<KnowledgeStage["deferredDocuments"]>> {
  if (Array.isArray(value?.deferredDocuments)) return deferredDocuments(value.deferredDocuments);
  return createRepositoryLayoutMigrationPlan({ repositoryRoot: root }).then(
    (plan) => deferredDocuments(plan.deferredDocuments),
    () => [],
  );
}

export async function inspectKnowledge(root: string): Promise<KnowledgeStage> {
  const result = await capture(
    (io) =>
      runKnowledgeMigration({
        args: ["--root", root, "--integration-head", "--json"],
        io,
        mode: "migrate",
      }),
    root,
  );
  const stage = await knowledgeDisposition(root, result);
  const deferred = await layoutDeferrals(root, result.value);
  return deferred.length === 0
    ? stage
    : { ...stage, deferredDocuments: deferred.slice(0, maximumReportedBlockers) };
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
  // Provider selection is owner work only when no background owner will normalize the debt.
  const backgroundOwner =
    envelope === null && status === "provider_required"
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
          : 0,
      },
    };
  }
  const decision =
    envelope === null && planKind === "repository_layout" && status === "review_required"
      ? await pendingLayoutDecision(root, result.value)
      : null;
  // A declined decision is settled, not current: the later knowledge stages it holds back stay
  // uninspected, so the stage reports them as deferred until the plan changes.
  if (decision !== null)
    return {
      ...(decision === "declined"
        ? { disposition: "deferred", reason: "layout_decision_declined" }
        : { disposition: "pending_authority", reason: "layout_decision_pending" }),
      planKind,
      planId,
      status,
      blockers: [],
      ...(decision === "declined" ? {} : { layoutDecision: decision }),
    };
  if (
    envelope === null &&
    ["review_required", "provider_required", "action_required"].includes(status)
  ) {
    return {
      disposition: "pending_authority",
      planKind,
      planId,
      status,
      reason: status,
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

export async function inspectTerminalIntegration(root: string): Promise<{
  stage: TerminalIntegrationStage;
  prepared: PreparedTerminalIntegration;
}> {
  const prepared = await planTerminalIntegrationStage(root);
  const { plan } = prepared;
  const disposition: StageDisposition =
    plan.status === "ready"
      ? "safe_apply"
      : plan.status === "review_required"
        ? "pending_authority"
        : plan.status === "blocked"
          ? "blocked"
          : "current";
  return {
    stage: {
      disposition,
      planId: plan.status === "current" ? null : plan.planId,
      status: plan.status,
      reason:
        plan.status === "ready"
          ? "generated_runtime_only"
          : plan.status === "review_required"
            ? "provider_hook_approval_required"
            : plan.status === "blocked"
              ? "provider_configuration_blocked"
              : "terminal_integration_current",
      blockers: plan.blockers.map((item) => ({
        code: item.code,
        path: item.path,
        message: `${item.provider} terminal integration is blocked by ${item.code}.`,
      })),
    },
    prepared,
  };
}

export async function inspectWorkforce(root: string): Promise<WorkforceStage> {
  const plan = await createWorkforceRoleBindingMigrationPlan(root);
  return {
    disposition:
      plan.status === "ready"
        ? "safe_apply"
        : plan.status === "review_required"
          ? "pending_authority"
          : plan.status === "blocked"
            ? "blocked"
            : "current",
    planId: plan.planId,
    staleAgentCount: plan.staleAgentCount,
    staleAssignmentCount: plan.staleAssignmentCount,
    status: plan.status,
    reason: plan.reason,
    requiredApprovals: plan.requiredApprovals,
  };
}

export async function applyKnowledgeStage(root: string, stage: KnowledgeStage): Promise<void> {
  if (stage.planId === null)
    throw new Error("A generated-only knowledge stage has no exact plan ID.");
  const result = await capture(
    (io) =>
      runKnowledgeMigration({
        args: ["--root", root, "--integration-head", "--apply", stage.planId!, "--json"],
        io,
        mode: "migrate",
      }),
    root,
  );
  if (result.code !== 0)
    throw capturedFailure(result, "The exact knowledge migration stage failed.");
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
