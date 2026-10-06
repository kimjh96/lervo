import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import {
  applyKnowledgeMigrationPlan,
  applyRepositoryLayoutMigrationPlan,
  applyContinuationWorkstreamMigrationPlan,
  canonicalJson,
  createKnowledgeInstructionBridgePlan,
  createKnowledgeMigrationPlan,
  createRepositoryLayoutMigrationPlan,
  createContinuationWorkstreamMigrationPlan,
  lintRepositoryKnowledge,
  matchesRecordedStructuralGeneration,
  inspectConfiguredDocumentNormalization,
  sha256,
  RepositoryKnowledgeError,
  serializableRepositoryLayoutMigrationPlan,
  serializableTerminalIntegrationPlan,
  structuralBundleIdFromPath,
  structuralConceptIdFromPath,
} from "@lervo/repository-knowledge";
import { openProjectStorage } from "@lervo/project-storage";
import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import { runDocumentNormalizationCommand } from "./document-normalization-command.js";
import {
  applyTerminalIntegrationStage,
  planTerminalIntegrationStage,
} from "./terminal-integration-stage.js";
import { CommandFailure, writeCommandError } from "./command-error-output.js";
import { runInstructionBootstrapStage } from "./instruction-bootstrap-command.js";
import type { CliIo } from "./types.js";
import { runKnowledgeInstruction } from "./knowledge-instruction-command.js";
import { knowledgeUsage } from "./knowledge-usage.js";
import {
  formatKnowledgeMigrationBlockers,
  formatKnowledgeMigrationPlan,
  formatRepositoryLayoutMigrationPlan,
  parseLayoutApprovals,
  printableKnowledgeMigrationPlan,
} from "./knowledge-migration-format.js";
import {
  formatTerminalIntegrationPlan,
  formatTerminalIntegrationReceipt,
  terminalActivation,
} from "./terminal-integration-format.js";
import {
  repositoryLayoutKnowledgeLintCodes,
  structuralKnowledgeLintCodes,
  validateKnowledgeStage,
} from "./knowledge-stage-lint.js";

function expectedInstructionBridgeTransitions(
  operations: ReadonlyArray<{ path: string; action: string }>,
): ReadonlySet<string> {
  return new Set(
    operations.some(
      (operation) =>
        operation.action !== "unchanged" &&
        (operation.path === "AGENTS.md" || operation.path === "CLAUDE.md"),
    )
      ? ["instruction_bridge_binding_stale"]
      : [],
  );
}

export async function runKnowledgeMigration(input: {
  args: string[];
  io: CliIo;
  mode: "migrate" | "refresh";
}): Promise<number> {
  let values: {
    root?: string;
    apply?: string;
    "approve-item"?: string[];
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
        "approve-item": { type: "string", multiple: true },
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
    input.io.stderr(
      `${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`,
    );
    return 1;
  }
  if (values.help) {
    input.io.stdout(`${knowledgeUsage}\n`);
    return 0;
  }
  try {
    const repositoryRoot = resolve(input.io.cwd, values.root ?? ".");
    if (values.rebuild === true && input.mode !== "refresh")
      throw new Error("--rebuild is supported only by lervo knowledge refresh.");
    const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
    if (input.mode === "migrate") {
      const projectStorage = await openProjectStorage(repositoryRoot);
      let continuation;
      try {
        continuation = await createContinuationWorkstreamMigrationPlan({
          repositoryRoot,
          projectId: projectStorage.manifest.projectId,
          ...(values["continuation-source"] === undefined
            ? {}
            : { sourcePath: values["continuation-source"] }),
          supplementalSources,
        });
      } finally {
        await projectStorage.close();
      }
      if (continuation.status !== "current") {
        if (values.apply === undefined) {
          if ((values["approve-item"]?.length ?? 0) > 0)
            throw new Error("--approve-item must be used with --apply.");
          input.io.stdout(
            values.json
              ? `${JSON.stringify(
                  {
                    ...continuation,
                    operations: continuation.operations.map((operation) => {
                      if (!("content" in operation)) return operation;
                      const { content: _content, ...printable } = operation;
                      return printable;
                    }),
                  },
                  null,
                  2,
                )}\n`
              : continuation.status === "blocked"
                ? `Continuation workstream migration is blocked.\n${continuation.blockers.map((item) => `  [${item.code}] ${item.message}`).join("\n")}\n${continuation.candidates.map((item) => `  candidate: ${item.path} declared=${item.signals.join(",")}`).join("\n")}\n`
                : `Continuation workstream migration review plan created.\nplan: ${continuation.planId}\nworkstream: ${continuation.workstream?.workstreamId}\nsource: ${continuation.sourcePath} (${continuation.sourceContentHash})\nreferences updated: ${continuation.referenceUpdates.length}\nnormalization records retired: ${continuation.removedNormalizationRecords.length}\napproval: ${continuation.operationId}=${continuation.approvalHash}\nNo files or state have been changed.\n`,
          );
          return continuation.status === "blocked" ? 1 : 0;
        }
        if (continuation.status === "blocked")
          throw new Error("The continuation workstream migration is blocked.");
        if (values.apply !== continuation.planId)
          throw new Error(
            "The requested plan ID does not match the current continuation workstream migration plan.",
          );
        if ((values["approve-item"]?.length ?? 0) !== 1)
          throw new Error(
            "Continuation workstream migration requires one exact --approve-item value.",
          );
        const approval = /^(kwstreamop_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/u.exec(
          values["approve-item"]![0]!,
        );
        if (approval === null)
          throw new Error("--approve-item must use <operation-id>=<sha256-approval-hash>.");
        const storage = await openProjectStorage(repositoryRoot);
        try {
          const eventIdentity = randomUUID().replaceAll("-", "");
          const receipt = await applyContinuationWorkstreamMigrationPlan({
            plan: continuation,
            approvedOperationId: approval[1]!,
            approvedHash: approval[2]!,
            now: new Date(),
            supplementalSources,
            recordApplied: async (applied, artifacts) => {
              const sourceArtifact = await storage.artifacts.put(artifacts.sourceContent);
              const snapshotArtifact = await storage.artifacts.put(artifacts.snapshotContent);
              if (
                sourceArtifact.contentHash !== applied.sourceContentHash ||
                snapshotArtifact.contentHash !== applied.snapshotContentHash
              ) {
                throw new RepositoryKnowledgeError(
                  "knowledge_apply_failed",
                  "The persisted workstream artifacts differ from the migration bindings.",
                );
              }
              storage.events.append({
                eventId: `evt_${eventIdentity}`,
                projectId: applied.projectId,
                runId: `run_${eventIdentity}`,
                sessionId: `ses_${eventIdentity}`,
                type: "workstream.snapshot.recorded",
                occurredAt: applied.appliedAt,
                actor: { kind: "user" },
                schemaVersion: 1,
                policyVersion: applied.approvalHash,
                payload: {
                  workstreamId: applied.workstreamId,
                  revision: applied.revision,
                  status: applied.status,
                  changeKind: "legacy_continuation_migration",
                  snapshotArtifactId: `art_${applied.snapshotContentHash.slice("sha256:".length)}`,
                  snapshotContentHash: applied.snapshotContentHash,
                  previousSnapshotContentHash: applied.previousSnapshotContentHash,
                  sourceArtifactId: `art_${applied.sourceContentHash.slice("sha256:".length)}`,
                  sourceContentHash: applied.sourceContentHash,
                  recordedAt: applied.appliedAt,
                },
              });
            },
          });
          input.io.stdout(
            values.json
              ? `${JSON.stringify(receipt, null, 2)}\n`
              : `Migrated ${continuation.sourcePath} into Lervo workstream state.\nworkstream: ${receipt.workstreamId}\nreferences updated: ${receipt.referenceUpdatedCount}\nRun lervo migrate knowledge again to refresh canonical documentation and navigation.\n`,
          );
        } finally {
          await storage.close();
        }
        return 0;
      }
    }
    const instructionBootstrapResult = await runInstructionBootstrapStage({
      repositoryRoot,
      supplementalSources,
      ...(values.apply === undefined ? {} : { applyPlanId: values.apply }),
      approvalItems: values["approve-item"] ?? [],
      json: values.json ?? false,
      io: input.io,
    });
    if (instructionBootstrapResult !== null) return instructionBootstrapResult;
    // The generated canonical AGENTS.md entrypoint is materialized by the base
    // knowledge stage. Defer agent-surface routing until that source exists so
    // a fresh repository containing portable skills can bootstrap safely.
    let hasCanonicalAgentInstructions = false;
    let generatedCanonicalAgentInstructions = false;
    try {
      const agentsPath = resolve(repositoryRoot, "AGENTS.md");
      hasCanonicalAgentInstructions = (await lstat(agentsPath)).isFile();
      if (hasCanonicalAgentInstructions) {
        const agentsContent = await readFile(agentsPath, "utf8");
        generatedCanonicalAgentInstructions =
          agentsContent.startsWith("<!-- lervo:generated repository-agent-entrypoint-v1 -->\n") &&
          (await matchesRecordedStructuralGeneration(
            repositoryRoot,
            "AGENTS.md",
            sha256(agentsContent),
          ));
      }
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
      input.mode === "migrate" &&
      !generatedCanonicalAgentInstructions &&
      !agentSurfaceWithoutCanonical
        ? await createRepositoryLayoutMigrationPlan({ repositoryRoot, supplementalSources })
        : null;
    if (layout !== null && layout.status !== "current") {
      if (values.apply === undefined) {
        if ((values["approve-item"]?.length ?? 0) > 0)
          throw new Error("--approve-item must be used with --apply.");
        input.io.stdout(
          values.json
            ? `${JSON.stringify(serializableRepositoryLayoutMigrationPlan(layout), null, 2)}\n`
            : formatRepositoryLayoutMigrationPlan(layout),
        );
        return layout.status === "review_required" || layout.status === "ready" ? 0 : 1;
      }
      if (values.apply !== layout.planId)
        throw new Error("The requested plan ID does not match the current repository layout plan.");
      const approvals = parseLayoutApprovals(values["approve-item"]);
      const baselineValidation = await lintRepositoryKnowledge(layout.repositoryRoot, {
        supplementalSources,
      });
      const storage = await openProjectStorage(layout.repositoryRoot);
      let receipt;
      try {
        const eventIdentity = randomUUID().replaceAll("-", "");
        receipt = await applyRepositoryLayoutMigrationPlan({
          plan: layout,
          approvals,
          now: new Date(),
          supplementalSources,
          recordApplied: async (applied) => {
            const observedValidation = await lintRepositoryKnowledge(layout.repositoryRoot, {
              allowTransactionPlanId: layout.planId,
              supplementalSources,
            });
            const validation = validateKnowledgeStage({
              stage: "repository layout migration",
              before: baselineValidation,
              after: observedValidation,
              ownedErrorCodes: repositoryLayoutKnowledgeLintCodes,
              expectedTransitionCodes: expectedInstructionBridgeTransitions(layout.operations),
            });
            const validationHash = sha256(canonicalJson(validation));
            await storage.artifacts.put(canonicalJson(validation));
            const conceptChanges = layout.operations
              .map((operation) => ({
                operation,
                match:
                  /^\.lervo\/knowledge\/concepts\/(?:[a-f0-9]{2}\/)?(concept_[a-f0-9]{24})\.yaml$/.exec(
                    operation.path,
                  ),
              }))
              .filter(
                (
                  item,
                ): item is {
                  operation: (typeof layout.operations)[number];
                  match: RegExpExecArray;
                } => item.match !== null,
              );
            const createdConceptIds = conceptChanges
              .filter((item) => item.operation.action === "create")
              .map((item) => item.match[1] as string)
              .slice(0, 256);
            const updatedConceptIds = conceptChanges
              .filter((item) => item.operation.action === "update")
              .map((item) => item.match[1] as string)
              .slice(0, 256);
            storage.events.append({
              eventId: `evt_${eventIdentity}`,
              projectId: layout.projectId,
              runId: `run_${eventIdentity}`,
              sessionId: `ses_${eventIdentity}`,
              type: "knowledge.materialization.applied",
              occurredAt: applied.appliedAt,
              actor: { kind: "system" },
              schemaVersion: 1,
              policyVersion: layout.policyHash,
              payload: {
                operation: "migrate",
                planId: applied.planId,
                sourceSnapshotId: applied.sourceSnapshotId,
                policyHash: layout.policyHash,
                compilerId: "lervo.repository-layout",
                compilerVersion: "1",
                approvalDigest: applied.approvalDigest,
                coverage: layout.coverage,
                bundleIds: [],
                createdConceptIds,
                updatedConceptIds,
                deprecatedConceptIds: [],
                conceptListTruncated: conceptChanges.length > 256,
                resultArtifactId: null,
                resultArtifactHash: null,
                createdCount: applied.created.length,
                updatedCount: applied.updated.length,
                unchangedCount: applied.unchanged.length,
                beforeRegistryDigest: layout.registryDigest,
                afterRegistryDigest: sha256(
                  canonicalJson(
                    layout.operations.map((item) => ({
                      pathDigest: sha256(item.path),
                      hash: item.action === "move" ? item.expectedCurrentHash : item.desiredHash,
                    })),
                  ),
                ),
                validationReportId: `klint_${validationHash.slice("sha256:".length, "sha256:".length + 24)}`,
                validationReportHash: validationHash,
                appliedAt: applied.appliedAt,
              },
            });
          },
        });
      } finally {
        await storage.close();
      }
      input.io.stdout(
        values.json
          ? `${JSON.stringify(receipt, null, 2)}\n`
          : `Repository document-layout migration completed.\nplan: ${receipt.planId}\nDocument moves: ${receipt.movedCount}\nMachine-artifact moves: ${receipt.machineMovedCount}\nReference updates: ${receipt.referenceUpdatedCount}\n`,
      );
      return 0;
    }
    const plan = await createKnowledgeMigrationPlan({
      repositoryRoot,
      mode: input.mode,
      repairMode: values.rebuild === true ? "replace_unrecorded_structural_records" : "none",
      reconciliationMode:
        values["integration-head"] === true ? "integration_head_incremental" : "full",
      supplementalSources,
    });
    const structuralCurrent = plan.operations.every(
      (operation) => operation.action === "unchanged",
    );
    if (input.mode === "migrate" && structuralCurrent) {
      const bridge = await createKnowledgeInstructionBridgePlan({
        repositoryRoot,
        provider: "claude",
        supplementalSources,
      });
      if (bridge.status !== "current") {
        if ((values["approve-item"]?.length ?? 0) > 1)
          throw new Error("The Claude instruction bridge accepts one exact --approve-item value.");
        return runKnowledgeInstruction(
          [
            "bridge",
            "--provider",
            "claude",
            "--root",
            repositoryRoot,
            ...(values.apply === undefined ? [] : ["--apply", values.apply]),
            ...(values["approve-item"]?.[0] === undefined
              ? []
              : ["--approve-item", values["approve-item"][0]]),
            ...(values.json ? ["--json"] : []),
          ],
          input.io,
        );
      }
    }
    if (input.mode === "migrate" && structuralCurrent) {
      const prepared = await planTerminalIntegrationStage(repositoryRoot);
      const terminal = prepared.plan;
      if (terminal.status !== "current") {
        if (values.apply === undefined) {
          if ((values["approve-item"]?.length ?? 0) > 0)
            throw new Error("--approve-item must be used with --apply.");
          input.io.stdout(
            values.json
              ? `${JSON.stringify(serializableTerminalIntegrationPlan(terminal), null, 2)}\n`
              : formatTerminalIntegrationPlan(terminal),
          );
          return terminal.status === "blocked" ? 1 : 0;
        }
        if (terminal.status === "blocked")
          throw new Error(
            "The terminal integration plan is blocked; provider configuration must be reviewed before apply.",
          );
        if (values.apply !== terminal.planId)
          throw new Error(
            "The requested plan ID does not match the current terminal integration plan.",
          );
        const approvalValues = values["approve-item"] ?? [];
        if (terminal.status === "review_required" && approvalValues.length !== 1)
          throw new Error("Terminal integration requires one exact --approve-item value.");
        if (terminal.status === "ready" && approvalValues.length !== 0)
          throw new Error(
            "Generated-only terminal runtime reconciliation does not accept --approve-item.",
          );
        const approval =
          terminal.status === "review_required"
            ? /^(ktermop_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/u.exec(approvalValues[0]!)
            : null;
        if (terminal.status === "review_required" && approval === null)
          throw new Error("--approve-item must use <operation-id>=<sha256-approval-hash>.");
        const receipt = await applyTerminalIntegrationStage({
          repositoryRoot,
          prepared,
          approval:
            approval === null ? null : { operationId: approval[1]!, approvalHash: approval[2]! },
          now: new Date(),
        });
        input.io.stdout(
          values.json
            ? `${JSON.stringify({ ...receipt, activation: terminalActivation }, null, 2)}\n`
            : formatTerminalIntegrationReceipt(receipt),
        );
        return 0;
      }
    }
    if (input.mode === "migrate" && structuralCurrent) {
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
            ...(values["approve-item"] ?? []).flatMap((approval) => ["--approve-item", approval]),
            ...(values.json ? ["--json"] : []),
          ],
          input.io,
        );
      }
      if (values.apply === undefined) {
        const normalization = await inspectConfiguredDocumentNormalization({
          repositoryRoot,
          supplementalSources,
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
          input.io.stdout(
            values.json
              ? `${JSON.stringify(result, null, 2)}\n`
              : `Repository content normalization requires an installed provider.\npending documents: ${normalization.pendingDocuments.length}/${normalization.eligibleDocuments}\nlanguage: ${normalization.outputLanguage} · format: ${normalization.formatVersion}\nRun lervo migrate knowledge --provider codex (or claude) to create the reviewable rewrite candidate.\n`,
          );
          return 0;
        }
      }
    }
    if ((values["approve-item"]?.length ?? 0) > 0)
      throw new Error("The current migration plan does not require item approvals.");
    if (values.apply === undefined) {
      input.io.stdout(
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
    const baselineValidation = await lintRepositoryKnowledge(plan.repositoryRoot, {
      supplementalSources,
    });
    const storage = await openProjectStorage(plan.repositoryRoot);
    let receipt;
    try {
      const eventIdentity = randomUUID().replaceAll("-", "");
      receipt = await applyKnowledgeMigrationPlan(
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
          const validationHash = sha256(canonicalJson(validation));
          await storage.artifacts.put(canonicalJson(validation));
          const conceptChanges = plan.operations
            .map((operation) => ({
              operation,
              conceptId: structuralConceptIdFromPath(operation.path),
            }))
            .filter(
              (item): item is { operation: (typeof plan.operations)[number]; conceptId: string } =>
                item.conceptId !== null,
            )
            .map((item) => ({ conceptId: item.conceptId, action: item.operation.action }));
          const createdConceptIds = conceptChanges
            .filter((item) => item.action === "create")
            .map((item) => item.conceptId);
          const updatedConceptIds = conceptChanges
            .filter((item) => item.action === "update")
            .map((item) => item.conceptId);
          const deprecatedConceptIds = conceptChanges
            .filter((item) => item.action === "delete")
            .map((item) => item.conceptId);
          const boundedConceptIds = [
            ...createdConceptIds,
            ...updatedConceptIds,
            ...deprecatedConceptIds,
          ].slice(0, 256);
          const overflow =
            createdConceptIds.length + updatedConceptIds.length + deprecatedConceptIds.length > 256
              ? await storage.artifacts.put(
                  canonicalJson({ createdConceptIds, updatedConceptIds, deprecatedConceptIds }),
                )
              : null;
          const bundleIds = plan.operations
            .map((item) => structuralBundleIdFromPath(item.path))
            .filter((item): item is string => item !== null)
            .slice(0, 256);
          storage.events.append({
            eventId: `evt_${eventIdentity}`,
            projectId: plan.projectId,
            runId: `run_${eventIdentity}`,
            sessionId: `ses_${eventIdentity}`,
            type: "knowledge.materialization.applied",
            occurredAt: applied.appliedAt,
            actor: { kind: "system" },
            schemaVersion: 1,
            policyVersion: plan.policyHash,
            payload: {
              operation: plan.mode,
              planId: applied.planId,
              sourceSnapshotId: applied.sourceSnapshotId,
              policyHash: plan.policyHash,
              compilerId: plan.compiler.id,
              compilerVersion: plan.compiler.version,
              approvalDigest: null,
              coverage: plan.coverage,
              bundleIds,
              createdConceptIds: boundedConceptIds.filter((id) => createdConceptIds.includes(id)),
              updatedConceptIds: boundedConceptIds.filter((id) => updatedConceptIds.includes(id)),
              deprecatedConceptIds: boundedConceptIds.filter((id) =>
                deprecatedConceptIds.includes(id),
              ),
              conceptListTruncated: overflow !== null,
              resultArtifactId:
                overflow === null ? null : `art_${overflow.contentHash.slice("sha256:".length)}`,
              resultArtifactHash: overflow?.contentHash ?? null,
              createdCount: applied.created.length,
              updatedCount: applied.updated.length,
              unchangedCount: applied.unchanged.length,
              deletedCount: applied.deleted.length,
              beforeRegistryDigest: sha256(
                canonicalJson(
                  plan.operations.map((item) => ({
                    pathDigest: sha256(item.path),
                    hash: item.expectedCurrentHash ?? null,
                  })),
                ),
              ),
              afterRegistryDigest: sha256(
                canonicalJson(
                  plan.operations.map((item) => ({
                    pathDigest: sha256(item.path),
                    hash: item.action === "delete" ? null : item.desiredHash,
                  })),
                ),
              ),
              validationReportId: `klint_${validationHash.slice("sha256:".length, "sha256:".length + 24)}`,
              validationReportHash: validationHash,
              appliedAt: applied.appliedAt,
            },
          });
        },
        { supplementalSources },
      );
    } finally {
      await storage.close();
    }
    input.io.stdout(
      values.json
        ? `${JSON.stringify(receipt, null, 2)}\n`
        : `Repository knowledge materialized. Created ${receipt.created.length}, updated ${receipt.updated.length}, unchanged ${receipt.unchanged.length}\nsource snapshot: ${receipt.sourceSnapshotId}\n`,
    );
    return 0;
  } catch (error) {
    writeCommandError(input.io, error, { json: values.json === true });
    return 1;
  }
}
