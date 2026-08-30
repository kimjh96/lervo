import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { applyCapabilityMigration, createCapabilityMigrationPlan } from "@lervo/capabilities";
import { loadProjectManifest } from "@lervo/project";
import { runKnowledgeCommand, runKnowledgeMigration } from "./knowledge-command.js";
import type { CliIo } from "./types.js";
import {
  applyRegisteredNodeUpgrade,
  inspectRegisteredNodeUpgrade,
  type NodeUpgradeStage,
} from "./upgrade-node.js";
import { readCliPackageVersion } from "./version-command.js";

export const upgradeUsage =
  "  lervo upgrade [--root <path>] [--apply --approval <plan-id>] [--json]";

type StageDisposition = "current" | "safe_apply" | "deferred" | "pending_authority" | "blocked";

interface KnowledgeStage {
  disposition: StageDisposition;
  planKind: string;
  planId: string | null;
  status: string;
  reason: string;
}

export interface RepositoryUpgradePlan {
  schemaVersion: 1;
  planKind: "repository_upgrade";
  planId: string;
  repositoryRoot: string;
  projectId: string;
  status: "ready" | "current" | "pending_authority" | "blocked";
  cli: { version: string; buildHash: string; acquisition: "outside_repository_upgrade" };
  policy: {
    generatedOnlyAutomaticApply: true;
    maximumKnowledgeStages: 16;
    userOwnedBytes: "exact_approval_required";
    providerConfiguration: "exact_approval_required";
    nodeService: "registered_instance_transactional_reconciliation";
  };
  stages: {
    capabilities: {
      disposition: StageDisposition;
      planId: string;
      createCount: number;
      observedProviderSurfaceCount: number;
    };
    knowledge: KnowledgeStage;
    node: NodeUpgradeStage;
  };
  privacy: {
    scope: "local_plan_and_receipt";
    credentials: "excluded";
    providerContent: "excluded";
    absolutePaths: "repository_root_only";
  };
  failureMeaning: string;
}

interface InternalUpgradePlan {
  publicPlan: RepositoryUpgradePlan;
}

interface CapturedCommand {
  code: number;
  value: Record<string, unknown> | null;
  error: string;
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function planIdentifier(value: unknown): string {
  return `upg_${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;
}

async function cliBuildHash(): Promise<string> {
  return sha256(await readFile(fileURLToPath(import.meta.url)));
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

async function inspectKnowledge(root: string): Promise<KnowledgeStage> {
  const result = await capture(
    (io) =>
      runKnowledgeMigration({
        args: ["--root", root, "--integration-head", "--json"],
        io,
        mode: "migrate",
      }),
    root,
  );
  if (result.value === null) {
    return {
      disposition: "blocked",
      planKind: "knowledge_migration",
      planId: null,
      status: "failed",
      reason: result.error || "knowledge_plan_unavailable",
    };
  }
  const status = typeof result.value.status === "string" ? result.value.status : "unknown";
  const planKind =
    typeof result.value.planKind === "string" ? result.value.planKind : "knowledge_materialization";
  const planId = typeof result.value.planId === "string" ? result.value.planId : null;
  const operations = Array.isArray(result.value.operations)
    ? (result.value.operations as Array<{ action?: unknown }>)
    : null;
  if (
    status === "current" ||
    (operations !== null && operations.every((item) => item.action === "unchanged"))
  ) {
    return {
      disposition: "current",
      planKind,
      planId,
      status,
      reason: "canonical_sources_current",
    };
  }
  if (status === "ready" && planId !== null) {
    return {
      disposition: "safe_apply",
      planKind,
      planId,
      status,
      reason: "generated_only_exact_plan",
    };
  }
  if (["review_required", "provider_required", "action_required"].includes(status)) {
    return { disposition: "pending_authority", planKind, planId, status, reason: status };
  }
  return {
    disposition: "blocked",
    planKind,
    planId,
    status,
    reason: result.error || status || `knowledge_plan_failed_${result.code}`,
  };
}

async function createInternalUpgradePlan(root: string): Promise<InternalUpgradePlan> {
  const repositoryRoot = await realpath(resolve(root));
  const project = await loadProjectManifest(repositoryRoot);
  const version = readCliPackageVersion();
  const capabilities = await createCapabilityMigrationPlan(repositoryRoot);
  const capabilityDisposition: StageDisposition =
    capabilities.status === "ready" ? "safe_apply" : "current";
  const [buildHash, knowledge, node] = await Promise.all([
    cliBuildHash(),
    capabilityDisposition === "safe_apply"
      ? Promise.resolve({
          disposition: "deferred" as const,
          planKind: "knowledge_migration",
          planId: null,
          status: "deferred",
          reason: "capability_migration_must_apply_first",
        })
      : inspectKnowledge(repositoryRoot),
    inspectRegisteredNodeUpgrade(repositoryRoot, project.projectId, version),
  ]);
  const dispositions = [capabilityDisposition, knowledge.disposition, node.stage.disposition];
  const status: RepositoryUpgradePlan["status"] = dispositions.includes("blocked")
    ? "blocked"
    : dispositions.includes("safe_apply")
      ? "ready"
      : dispositions.includes("pending_authority")
        ? "pending_authority"
        : "current";
  const body = {
    schemaVersion: 1 as const,
    planKind: "repository_upgrade" as const,
    repositoryRoot,
    projectId: project.projectId,
    status,
    cli: { version, buildHash, acquisition: "outside_repository_upgrade" as const },
    policy: {
      generatedOnlyAutomaticApply: true as const,
      maximumKnowledgeStages: 16 as const,
      userOwnedBytes: "exact_approval_required" as const,
      providerConfiguration: "exact_approval_required" as const,
      nodeService: "registered_instance_transactional_reconciliation" as const,
    },
    stages: {
      capabilities: {
        disposition: capabilityDisposition,
        planId: capabilities.planId,
        createCount: capabilities.items.filter((item) => item.action === "create").length,
        observedProviderSurfaceCount: capabilities.observedProviderSurfaces.length,
      },
      knowledge,
      node: node.stage,
    },
    privacy: {
      scope: "local_plan_and_receipt" as const,
      credentials: "excluded" as const,
      providerContent: "excluded" as const,
      absolutePaths: "repository_root_only" as const,
    },
    failureMeaning:
      "A non-current stage is not proof of migration, provider activation, Node readiness, or CLI acquisition.",
  };
  return { publicPlan: { ...body, planId: planIdentifier(body) } };
}

export async function createRepositoryUpgradePlan(root: string): Promise<RepositoryUpgradePlan> {
  return (await createInternalUpgradePlan(root)).publicPlan;
}

async function applyKnowledgeStage(root: string, stage: KnowledgeStage): Promise<void> {
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
    throw new Error(result.error || "The exact knowledge migration stage failed.");
}

async function lintKnowledge(root: string): Promise<{ valid: boolean; issueCount: number }> {
  const result = await capture(
    (io) => runKnowledgeCommand(["lint", "--root", root, "--json"], io),
    root,
  );
  const valid = result.code === 0 && result.value?.valid === true;
  const issues = Array.isArray(result.value?.issues) ? result.value.issues.length : valid ? 0 : 1;
  if (!valid)
    throw new Error(result.error || `Repository knowledge lint failed with ${issues} issue(s).`);
  return { valid, issueCount: issues };
}

export async function runUpgradeCommand(args: string[], io: CliIo): Promise<number> {
  let values: { root?: string; apply?: boolean; approval?: string; json?: boolean; help?: boolean };
  try {
    values = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        root: { type: "string" },
        apply: { type: "boolean" },
        approval: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    }).values;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${upgradeUsage}\n`);
    return 1;
  }
  if (values.help) {
    io.stdout(`${upgradeUsage}\n`);
    return 0;
  }
  if ((values.apply === true) !== (values.approval !== undefined)) {
    io.stderr(`Upgrade apply requires both --apply and --approval.\n${upgradeUsage}\n`);
    return 1;
  }
  const root = resolve(io.cwd, values.root ?? ".");
  try {
    const initial = await createInternalUpgradePlan(root);
    if (!values.apply) {
      io.stdout(
        values.json
          ? `${JSON.stringify(initial.publicPlan, null, 2)}\n`
          : formatUpgradePlan(initial.publicPlan),
      );
      return initial.publicPlan.status === "blocked" ? 1 : 0;
    }
    if (values.approval !== initial.publicPlan.planId)
      throw new Error("--approval must equal the exact current repository upgrade plan ID.");
    if (initial.publicPlan.status === "blocked")
      throw new Error("The current repository upgrade plan is blocked and cannot be applied.");

    const appliedStages: string[] = [];
    if (initial.publicPlan.stages.capabilities.disposition === "safe_apply") {
      const capabilityPlan = await createCapabilityMigrationPlan(initial.publicPlan.repositoryRoot);
      if (capabilityPlan.planId !== initial.publicPlan.stages.capabilities.planId)
        throw new Error("The capability migration plan changed before apply.");
      await applyCapabilityMigration(capabilityPlan);
      appliedStages.push("capabilities");
    }

    for (let index = 0; index < initial.publicPlan.policy.maximumKnowledgeStages; index += 1) {
      const stage = await inspectKnowledge(initial.publicPlan.repositoryRoot);
      if (stage.disposition !== "safe_apply") break;
      await applyKnowledgeStage(initial.publicPlan.repositoryRoot, stage);
      appliedStages.push(stage.planKind);
      if (index === initial.publicPlan.policy.maximumKnowledgeStages - 1)
        throw new Error(
          "The bounded knowledge upgrade did not converge within 16 generated-only stages.",
        );
    }

    const postKnowledge = await inspectKnowledge(initial.publicPlan.repositoryRoot);
    if (postKnowledge.disposition === "blocked")
      throw new Error(`Repository knowledge upgrade is blocked (${postKnowledge.reason}).`);
    const lint = await lintKnowledge(initial.publicPlan.repositoryRoot);
    const node = await inspectRegisteredNodeUpgrade(
      initial.publicPlan.repositoryRoot,
      initial.publicPlan.projectId,
      initial.publicPlan.cli.version,
    );
    if (node.stage.disposition === "safe_apply") {
      await applyRegisteredNodeUpgrade(node);
      appliedStages.push("repository_node");
    }

    const final = await createInternalUpgradePlan(initial.publicPlan.repositoryRoot);
    const receipt = {
      schemaVersion: 1,
      operation: "repository_upgrade",
      approvedPlanId: initial.publicPlan.planId,
      status: final.publicPlan.status,
      appliedStages,
      knowledgeLint: lint,
      nextPlanId: final.publicPlan.status === "current" ? null : final.publicPlan.planId,
      pending: [
        final.publicPlan.stages.capabilities,
        final.publicPlan.stages.knowledge,
        final.publicPlan.stages.node,
      ]
        .filter(
          (stage) => stage.disposition === "pending_authority" || stage.disposition === "blocked",
        )
        .map((stage) => ({
          disposition: stage.disposition,
          reason: "reason" in stage ? stage.reason : "capability_migration_pending",
        })),
      cliAcquisition: "outside_repository_upgrade",
    };
    io.stdout(
      values.json ? `${JSON.stringify(receipt, null, 2)}\n` : formatUpgradeReceipt(receipt),
    );
    return final.publicPlan.status === "blocked" ? 1 : 0;
  } catch (error) {
    const code =
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
        ? ` (${error.code})`
        : "";
    io.stderr(
      `Repository upgrade failed${code}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

export function formatUpgradePlan(plan: RepositoryUpgradePlan): string {
  const lines = [
    `Repository upgrade: ${plan.status}`,
    `plan: ${plan.planId}`,
    `CLI: ${plan.cli.version} · ${plan.cli.buildHash}`,
    `capabilities: ${plan.stages.capabilities.disposition}`,
    `knowledge: ${plan.stages.knowledge.disposition} (${plan.stages.knowledge.reason})`,
    `repository Node: ${plan.stages.node.disposition} (${plan.stages.node.reason})`,
  ];
  if (plan.status === "ready") lines.push(`Re-run with --apply --approval ${plan.planId}.`);
  if (plan.status === "pending_authority")
    lines.push(
      "A user-owned or provider-owned boundary requires its separately displayed exact approval before the upgrade can become current.",
    );
  lines.push("CLI package acquisition is outside this repository-upgrade plan.");
  return `${lines.join("\n")}\n`;
}

function formatUpgradeReceipt(receipt: {
  status: string;
  appliedStages: string[];
  nextPlanId: string | null;
  pending: Array<{ reason: string }>;
}): string {
  return `Repository upgrade: ${receipt.status}\napplied: ${receipt.appliedStages.length === 0 ? "none" : receipt.appliedStages.join(", ")}\n${receipt.nextPlanId === null ? "" : `next plan: ${receipt.nextPlanId}\n`}${receipt.pending.map((item) => `pending: ${item.reason}`).join("\n")}${receipt.pending.length === 0 ? "" : "\n"}`;
}
