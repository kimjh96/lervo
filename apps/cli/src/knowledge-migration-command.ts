import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import {
  applyKnowledgeMigrationPlan,
  applyRepositoryLayoutMigrationPlan,
  applyTerminalIntegrationPlan,
  applyContinuationWorkstreamMigrationPlan,
  canonicalJson,
  createKnowledgeInstructionBridgePlan,
  createKnowledgeMigrationPlan,
  createRepositoryLayoutMigrationPlan,
  createTerminalIntegrationPlan,
  createContinuationWorkstreamMigrationPlan,
  lintRepositoryKnowledge,
  matchesRecordedStructuralGeneration,
  inspectConfiguredDocumentNormalization,
  sha256,
  RepositoryKnowledgeError,
  serializableRepositoryLayoutMigrationPlan,
  serializableTerminalIntegrationPlan,
} from "@lervo/repository-knowledge";
import { openProjectStorage } from "@lervo/project-storage";
import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import { runDocumentNormalizationCommand } from "./document-normalization-command.js";
import { loadTerminalHookRuntime } from "./terminal-runtime.js";
import { runInstructionBootstrapStage } from "./instruction-bootstrap-command.js";
import type { CliIo } from "./types.js";
import { runKnowledgeInstruction } from "./knowledge-instruction-command.js";
import { knowledgeUsage } from "./knowledge-usage.js";
import {
  formatKnowledgeMigrationPlan,
  formatRepositoryLayoutMigrationPlan,
  parseLayoutApprovals,
  printableKnowledgeMigrationPlan,
} from "./knowledge-migration-format.js";

function latestTerminalIntegrationApplicationEventId(
  storage: Awaited<ReturnType<typeof openProjectStorage>>,
): string | null {
  let afterSeq = 0;
  let latest: string | null = null;
  while (true) {
    const events = storage.events.list({ afterSeq, limit: 1000 });
    if (events.length === 0) return latest;
    for (const event of events) {
      afterSeq = event.seq;
      if (event.type === "terminal.integration.applied") latest = event.eventId;
    }
    if (events.length < 1000) return latest;
  }
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
                ? `Continuation workstream migration is blocked.\n${continuation.blockers.map((item) => `  [${item.code}] ${item.message}`).join("\n")}\n${continuation.candidates.map((item) => `  candidate: ${item.path} score=${item.score} signals=${item.signals.join(",")}`).join("\n")}\n`
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
            const validation = await lintRepositoryKnowledge(layout.repositoryRoot, {
              allowTransactionPlanId: layout.planId,
              supplementalSources,
            });
            if (!validation.valid) {
              const issueCodes = [...new Set(validation.issues.map((issue) => issue.code))]
                .sort()
                .join(",");
              throw new RepositoryKnowledgeError(
                "knowledge_apply_failed",
                `Deterministic lint failed after repository layout migration: ${issueCodes}`,
              );
            }
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
    let hasClaudeEntrypoint = false;
    try {
      hasClaudeEntrypoint = (await lstat(resolve(repositoryRoot, "CLAUDE.md"))).isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (input.mode === "migrate" && hasClaudeEntrypoint) {
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
    const plan = await createKnowledgeMigrationPlan({
      repositoryRoot,
      mode: input.mode,
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
      const runtimeContent = await loadTerminalHookRuntime();
      const historyStorage = await openProjectStorage(repositoryRoot);
      let priorApplicationEventId: string | null;
      try {
        priorApplicationEventId = latestTerminalIntegrationApplicationEventId(historyStorage);
      } finally {
        await historyStorage.close();
      }
      const terminal = await createTerminalIntegrationPlan(
        repositoryRoot,
        runtimeContent,
        priorApplicationEventId,
      );
      if (terminal.status !== "current") {
        if (values.apply === undefined) {
          if ((values["approve-item"]?.length ?? 0) > 0)
            throw new Error("--approve-item must be used with --apply.");
          input.io.stdout(
            values.json
              ? `${JSON.stringify(serializableTerminalIntegrationPlan(terminal), null, 2)}\n`
              : terminal.status === "blocked"
                ? `Terminal integration migration is blocked.\n${terminal.blockers.map((item) => `  ${item.provider} [${item.code}] ${item.path}`).join("\n")}\nExisting provider settings and hooks were not changed.\n`
                : `${terminal.status === "ready" ? "Terminal runtime reconciliation plan created." : "Terminal integration review plan created."}\nplan: ${terminal.planId}\ncontract: ${terminal.contractId}\nruntime: ${terminal.runtime.action} ${terminal.runtime.path}\ntargets:\n${terminal.targets.map((item) => `  ${item.provider}: ${item.action} ${item.path} · ${item.beforeHash ?? "absent"} → ${item.afterHash ?? "blocked"}`).join("\n")}${terminal.approvalHash === null ? "\nNo user-owned hook bytes require approval." : `\napproval: ${terminal.operationId}=${terminal.approvalHash}`}\nExisting provider settings and hooks have not been changed.\n`,
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
        const storage = await openProjectStorage(repositoryRoot);
        try {
          if (
            latestTerminalIntegrationApplicationEventId(storage) !==
            terminal.priorApplicationEventId
          )
            throw new Error("Terminal integration application history changed after planning.");
          if (
            storage.events
              .list()
              .some(
                (event) =>
                  event.type === "terminal.integration.applied" &&
                  event.payload.planId === terminal.planId,
              )
          )
            throw new Error("The same terminal integration plan was already applied.");
          const identity = randomUUID().replaceAll("-", "");
          const receipt = await applyTerminalIntegrationPlan({
            plan: terminal,
            runtimeContent,
            ...(approval === null
              ? {}
              : { approvedOperationId: approval[1]!, approvedHash: approval[2]! }),
            now: new Date(),
            recordApplied: (applied) => {
              storage.events.append({
                eventId: `evt_${identity}`,
                projectId: terminal.projectId,
                runId: `run_${identity}`,
                sessionId: `ses_${identity}`,
                type: "terminal.integration.applied",
                occurredAt: applied.appliedAt,
                actor:
                  terminal.status === "review_required" ? { kind: "user" } : { kind: "system" },
                schemaVersion: 1,
                policyVersion: terminal.approvalHash ?? terminal.runtime.afterHash,
                payload: {
                  operation: applied.operation,
                  planId: applied.planId,
                  contractId: applied.contractId,
                  providers: terminal.providers,
                  targetPathDigests: applied.targetDigests.map((item) => item.pathDigest),
                  targetAfterHashes: applied.targetDigests.map((item) => item.afterHash),
                  runtimePathDigest: applied.runtimePathDigest,
                  runtimeAfterHash: applied.runtimeAfterHash,
                  approvalHash: applied.approvalHash,
                  appliedAt: applied.appliedAt,
                },
              });
            },
          });
          const activation = {
            status: "action_required" as const,
            requiredOnce: {
              provider: "codex" as const,
              instruction:
                "Open Codex in this repository, run /hooks, then review and trust the Lervo UserPromptSubmit and Stop command hooks. Codex skips untrusted project hooks.",
            },
            verification:
              "Run lervo terminal status after one prompt and one completed turn in each installed provider.",
          };
          input.io.stdout(
            values.json
              ? `${JSON.stringify({ ...receipt, activation }, null, 2)}\n`
              : `Applied the Codex and Claude terminal integration without replacing existing provider hooks.\nplan: ${receipt.planId}\ncontract: ${receipt.contractId}\nACTION REQUIRED ONCE FOR CODEX: ${activation.requiredOnce.instruction}\nVERIFY: ${activation.verification}\n`,
          );
        } finally {
          await storage.close();
        }
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
    if (values.apply !== plan.planId) {
      input.io.stderr(
        "The requested plan ID does not match the current read-only plan. A source or target may have changed; review the plan again.\n",
      );
      return 1;
    }
    const storage = await openProjectStorage(plan.repositoryRoot);
    let receipt;
    try {
      const eventIdentity = randomUUID().replaceAll("-", "");
      receipt = await applyKnowledgeMigrationPlan(
        plan,
        new Date(),
        async (applied) => {
          const validation = await lintRepositoryKnowledge(plan.repositoryRoot, {
            supplementalSources,
          });
          if (!validation.valid)
            throw new Error("Deterministic lint failed after materialization.");
          const validationHash = sha256(canonicalJson(validation));
          await storage.artifacts.put(canonicalJson(validation));
          const conceptChanges = plan.operations
            .map((operation) => ({
              operation,
              match: /^\.lervo\/knowledge\/concepts\/(concept_[a-f0-9]{24})\.yaml$/.exec(
                operation.path,
              ),
            }))
            .filter(
              (
                item,
              ): item is { operation: (typeof plan.operations)[number]; match: RegExpExecArray } =>
                item.match !== null,
            )
            .map((item) => ({ conceptId: item.match[1] as string, action: item.operation.action }));
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
            .map(
              (item) =>
                /^\.lervo\/knowledge\/bundles\/(bundle_[a-f0-9]{24})\.yaml$/.exec(item.path)?.[1],
            )
            .filter((item): item is string => item !== undefined)
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
    input.io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
