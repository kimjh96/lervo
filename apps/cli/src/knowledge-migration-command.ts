import { ensureHostTerminalRuntime } from "./terminal-runtime.js";
import { rememberTerminalWorkerEntry } from "./terminal-worker-entry.js";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { lstat } from "node:fs/promises";
import {
  applyKnowledgeMigrationPlan,
  createKnowledgeInstructionBridgePlan,
  type RepositoryKnowledgeScan,
  type RepositoryLayoutMigrationPlan,
  createKnowledgeMigrationPlan,
  lintRepositoryKnowledge,
  inspectConfiguredDocumentNormalization,
  scanConfiguredRepositoryKnowledge,
  serializableTerminalIntegrationPlan,
} from "@lervo/repository-knowledge";
import { openProjectStorage } from "@lervo/project-storage";
import { lifecycleChangedPaths } from "@lervo/repository-knowledge-runtime";
import { applyGeneratedEffect, assertKnowledgeEffectApplicable } from "./generated-effect.js";
import { planKnowledgeMigrationRouting } from "./knowledge-migration-routing.js";
import { migrationDeferralOutput } from "./knowledge-migration-deferrals.js";
import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import { foregroundKnowledgeMaterializationSettlement } from "./knowledge-materialization-wait.js";
import { runDocumentNormalizationCommand } from "./document-normalization-command.js";
import {
  applyTerminalIntegrationStage,
  planTerminalIntegrationStage,
} from "./terminal-integration-stage.js";
import { CommandFailure, writeCommandError } from "./command-error-output.js";
import { runInstructionBootstrapStage } from "./instruction-bootstrap-command.js";
import type { CliIo, CliServices } from "./types.js";
import { runInstructionBridge } from "./instruction-bridge-command.js";
import { knowledgeUsage } from "./knowledge-usage.js";
import { recordStructuralMaterialization } from "./structural-materialization-event.js";
import {
  formatKnowledgeMigrationBlockers,
  formatKnowledgeMigrationPlan,
  printableKnowledgeMigrationPlan,
} from "./knowledge-migration-format.js";
import { runRepositoryLayoutStage } from "./repository-layout-stage.js";
import { runContinuationWorkstreamStage } from "./continuation-workstream-stage.js";
import { crossCheckPlan } from "./plan-cross-check.js";
import { REMOVED_APPROVE_ITEM, REMOVED_LAYOUT_DECISION } from "./removed-approval-options.js";
import {
  formatTerminalIntegrationPlan,
  formatTerminalIntegrationReceipt,
  terminalActivation,
} from "./terminal-integration-format.js";
import {
  expectedInstructionBridgeTransitions,
  structuralKnowledgeLintCodes,
  validateKnowledgeStage,
} from "./knowledge-stage-lint.js";

export async function runKnowledgeMigration(input: {
  args: string[];
  io: CliIo;
  mode: "migrate" | "refresh";
  /** Receives the layout plan this run evaluated, so a caller need not plan it again. */
  observeLayout?: (layout: RepositoryLayoutMigrationPlan) => void;
  services?: Partial<Pick<CliServices, "crossCheckPlan">>;
}): Promise<number> {
  let io = input.io;
  const crossCheck = input.services?.crossCheckPlan ?? crossCheckPlan;
  if (input.args.some((arg) => /^--(?:accept|decline)-layout(?:=|$)/u.test(arg))) {
    io.stderr(`${REMOVED_LAYOUT_DECISION}\n`);
    return 1;
  }
  if (input.args.some((arg) => /^--approve-item(?:=|$)/u.test(arg))) {
    io.stderr(`${REMOVED_APPROVE_ITEM}\n`);
    return 1;
  }
  let values: {
    root?: string;
    apply?: string;
    "continuation-source"?: string;
    provider?: string;
    candidate?: string;
    model?: string;
    executable?: string;
    "timeout-ms"?: string;
    json?: boolean;
    help?: boolean;
    rebuild?: boolean;
    "integration-head"?: boolean;
  };
  try {
    values = parseArgs({
      args: input.args,
      strict: true,
      allowPositionals: false,
      options: {
        root: { type: "string" },
        apply: { type: "string" },
        "continuation-source": { type: "string" },
        provider: { type: "string" },
        candidate: { type: "string" },
        model: { type: "string" },
        executable: { type: "string" },
        "timeout-ms": { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        rebuild: { type: "boolean" },
        "integration-head": { type: "boolean" },
      },
    }).values;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
    return 1;
  }
  if (values.help) {
    io.stdout(`${knowledgeUsage}\n`);
    return 0;
  }
  try {
    const repositoryRoot = resolve(io.cwd, values.root ?? ".");
    if (
      values.provider !== undefined &&
      values.provider !== "codex" &&
      values.provider !== "claude"
    )
      throw new Error("--provider must be codex or claude.");
    const provider = values.provider as "codex" | "claude" | undefined;
    if (input.mode === "migrate") {
      await ensureHostTerminalRuntime();
      await rememberTerminalWorkerEntry(repositoryRoot, process.env.LERVO_CLI_ENTRY);
    }
    if (values.rebuild === true && input.mode !== "refresh")
      throw new Error("--rebuild is supported only by lervo knowledge refresh.");
    await foregroundKnowledgeMaterializationSettlement({ repositoryRoot, io }).settle();
    const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
    // ADR-0578: the stage plans before the first write read one scan. Every apply recreates its
    // plan from a fresh scan and refuses a different plan ID, so the shared scan cannot go stale.
    // An apply releases it first, so it never doubles the apply's peak memory.
    let preparedScan: RepositoryKnowledgeScan | undefined = (
      await scanConfiguredRepositoryKnowledge(repositoryRoot, { supplementalSources })
    ).scan;
    const stage = {
      repositoryRoot,
      supplementalSources,
      ...(values.apply === undefined ? {} : { applyPlanId: values.apply }),
      ...(provider === undefined ? {} : { provider }),
      json: values.json ?? false,
      io,
      crossCheckPlan: crossCheck,
    };
    const continuation =
      input.mode === "migrate"
        ? await runContinuationWorkstreamStage({
            ...stage,
            preparedScan,
            ...(values["continuation-source"] === undefined
              ? {}
              : { sourcePath: values["continuation-source"] }),
          })
        : null;
    if (continuation !== null) return continuation;
    const bootstrap = await runInstructionBootstrapStage({ ...stage, preparedScan });
    if (bootstrap !== null) return bootstrap;
    // The generated canonical AGENTS.md entrypoint is materialized by the base
    // knowledge stage. Defer agent-surface routing until that source exists so
    // a fresh repository containing portable skills can bootstrap safely.
    let hasCanonicalAgentInstructions = false;
    try {
      const agentsPath = resolve(repositoryRoot, "AGENTS.md");
      hasCanonicalAgentInstructions = (await lstat(agentsPath)).isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const agentSurfaceWithoutCanonical =
      !hasCanonicalAgentInstructions &&
      (
        await Promise.all(
          [".agents/skills", ".claude/rules", "docs/instructions"].map(async (path) => {
            try {
              return (await lstat(resolve(repositoryRoot, path))).isDirectory();
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
              throw error;
            }
          }),
        )
      ).some(Boolean);
    const layout =
      input.mode === "migrate" && !agentSurfaceWithoutCanonical
        ? await planKnowledgeMigrationRouting({
            repositoryRoot,
            supplementalSources,
            preparedScan,
            classify: values.apply === undefined,
            ...(values.provider === undefined ? {} : { provider: values.provider }),
            ...(values.model === undefined ? {} : { model: values.model }),
            ...(values.executable === undefined ? {} : { executable: values.executable }),
            ...(values["timeout-ms"] === undefined ? {} : { timeoutMs: values["timeout-ms"] }),
          })
        : null;
    if (layout !== null) input.observeLayout?.(layout);
    if (layout !== null && layout.status !== "current") {
      if (values.apply !== undefined) preparedScan = undefined;
      return await runRepositoryLayoutStage({ ...stage, layout });
    }
    io = migrationDeferralOutput(io, layout, values.json ?? false);
    const plan = await createKnowledgeMigrationPlan({
      repositoryRoot,
      mode: input.mode,
      repairMode: values.rebuild === true ? "replace_unrecorded_structural_records" : "none",
      reconciliationMode:
        values["integration-head"] === true ? "integration_head_incremental" : "full",
      supplementalSources,
      preparedScan,
    });
    const structuralCurrent = plan.operations.every(
      (operation) => operation.action === "unchanged",
    );
    if (input.mode === "migrate" && structuralCurrent) {
      const bridge = await createKnowledgeInstructionBridgePlan({
        repositoryRoot,
        provider: "claude",
        supplementalSources,
        preparedScan,
      });
      if (bridge.status !== "current") return await runInstructionBridge(stage);
    }
    if (input.mode === "migrate" && structuralCurrent) {
      const prepared = await planTerminalIntegrationStage(repositoryRoot);
      const terminal = prepared.plan;
      if (terminal.status !== "current") {
        if (values.apply === undefined) {
          io.stdout(
            values.json
              ? `${JSON.stringify(serializableTerminalIntegrationPlan(terminal), null, 2)}\n`
              : formatTerminalIntegrationPlan(terminal),
          );
          return terminal.status === "blocked" ? 1 : 0;
        }
        if (terminal.status === "blocked")
          throw new Error(
            "The terminal integration plan is blocked; provider configuration must be repaired before apply.",
          );
        if (values.apply !== terminal.planId)
          throw new Error(
            "The requested plan ID does not match the current terminal integration plan.",
          );
        await assertKnowledgeEffectApplicable(
          repositoryRoot,
          terminal.operations.map((operation) => operation.path),
          terminal.planId,
        );
        const { receipt, backupId } = await applyTerminalIntegrationStage({
          repositoryRoot,
          prepared,
          now: new Date(),
        });
        io.stdout(
          values.json
            ? `${JSON.stringify({ ...receipt, backupId, activation: terminalActivation }, null, 2)}\n`
            : formatTerminalIntegrationReceipt(receipt, backupId),
        );
        return 0;
      }
    }
    if (input.mode === "migrate" && structuralCurrent) {
      if (
        values.provider !== undefined &&
        values.candidate === undefined &&
        layout?.deferredDocuments.some((document) => document.resolution === "provider_unavailable")
      ) {
        io.stdout(
          values.json
            ? `${JSON.stringify(printableKnowledgeMigrationPlan(plan), null, 2)}\n`
            : formatKnowledgeMigrationPlan(plan),
        );
        return plan.status === "ready" ? 0 : 1;
      }
      if (values.provider !== undefined || values.candidate !== undefined) {
        return runDocumentNormalizationCommand(
          [
            ...(values.provider === undefined ? [] : ["--provider", values.provider]),
            ...(values.candidate === undefined ? [] : ["--candidate", values.candidate]),
            "--root",
            repositoryRoot,
            ...(values.model === undefined ? [] : ["--model", values.model]),
            ...(values.executable === undefined ? [] : ["--executable", values.executable]),
            ...(values["timeout-ms"] === undefined ? [] : ["--timeout-ms", values["timeout-ms"]]),
            ...(values.apply === undefined ? [] : ["--apply", values.apply]),
            ...(values.json ? ["--json"] : []),
          ],
          io,
          { crossCheckPlan: crossCheck },
        );
      }
      if (values.apply === undefined) {
        const normalization = await inspectConfiguredDocumentNormalization({
          repositoryRoot,
          supplementalSources,
          preparedScan,
        });
        if (normalization.pendingDocuments.length > 0) {
          const result = {
            schemaVersion: 1,
            planKind: "document_normalization_provider_selection",
            status: "provider_required",
            repositoryRoot,
            outputLanguage: normalization.outputLanguage,
            formatVersion: normalization.formatVersion,
            eligibleDocuments: normalization.eligibleDocuments,
            currentDocuments: normalization.currentDocuments,
            pendingDocuments: normalization.pendingDocuments,
            supportedProviders: ["codex", "claude"],
          };
          io.stdout(
            values.json
              ? `${JSON.stringify(result, null, 2)}\n`
              : `Repository content normalization requires an installed provider.\npending documents: ${normalization.pendingDocuments.length}/${normalization.eligibleDocuments}\nlanguage: ${normalization.outputLanguage} · format: ${normalization.formatVersion}\nRun lervo migrate knowledge --provider codex (or claude) to create the reviewable rewrite candidate.\n`,
          );
          return 0;
        }
      }
    }
    if (values.apply === undefined) {
      io.stdout(
        values.json
          ? `${JSON.stringify(printableKnowledgeMigrationPlan(plan), null, 2)}\n`
          : formatKnowledgeMigrationPlan(plan),
      );
      return plan.status === "ready" ? 0 : 1;
    }
    if (values.apply !== plan.planId)
      throw new CommandFailure(
        "knowledge_plan_stale",
        "The requested plan ID does not match the current read-only plan. A source or target may have changed; review the plan again.",
      );
    if (plan.status === "blocked")
      throw new CommandFailure(
        "knowledge_plan_blocked",
        `The repository knowledge ${plan.mode} plan is blocked and was not applied.\n${formatKnowledgeMigrationBlockers(plan).join("\n")}`,
        {
          planId: plan.planId,
          blockers: plan.blockers,
          conflicts: plan.operations
            .filter((operation) => operation.action === "conflict")
            .map(({ path, reason }) => ({ path, reason })),
        },
      );
    preparedScan = undefined;
    const baselineValidation = await lintRepositoryKnowledge(plan.repositoryRoot, {
      supplementalSources,
    });
    const storage = await openProjectStorage(plan.repositoryRoot);
    let receipt;
    try {
      // ADR-0610: generated knowledge outputs land as their own commit on the base branch; ignored
      // projections leave nothing to commit.
      ({ receipt } = await applyGeneratedEffect({
        repositoryRoot: plan.repositoryRoot,
        paths: lifecycleChangedPaths(plan),
        notice: {
          effect: "knowledge_migration",
          planId: plan.planId,
          reason: "refreshed the generated repository knowledge outputs",
        },
        apply: () =>
          applyKnowledgeMigrationPlan(
            plan,
            new Date(),
            async (applied) => {
              const observedValidation = await lintRepositoryKnowledge(plan.repositoryRoot, {
                supplementalSources,
              });
              const validation = validateKnowledgeStage({
                stage: "structural materialization",
                before: baselineValidation,
                after: observedValidation,
                ownedErrorCodes: structuralKnowledgeLintCodes,
                expectedTransitionCodes: expectedInstructionBridgeTransitions(plan.operations),
              });
              await recordStructuralMaterialization({ storage, plan, applied, validation });
            },
            { supplementalSources },
          ),
      }));
    } finally {
      await storage.close();
    }
    io.stdout(
      values.json
        ? `${JSON.stringify(receipt, null, 2)}\n`
        : `Repository knowledge materialized. Created ${receipt.created.length}, updated ${receipt.updated.length}, unchanged ${receipt.unchanged.length}\nsource snapshot: ${receipt.sourceSnapshotId}\n`,
    );
    return 0;
  } catch (error) {
    writeCommandError(io, error, { json: values.json === true });
    return 1;
  }
}
