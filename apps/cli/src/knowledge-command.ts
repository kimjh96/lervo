import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";

import {
  applyKnowledgeMigrationPlan,
  applyRepositoryLayoutMigrationPlan,
  applyKnowledgeDocumentMergePlan,
  applyKnowledgeDocumentMovePlan,
  applyKnowledgeDocumentSplitPlan,
  applyKnowledgeInstructionBridgePlan,
  applySemanticKnowledgeMaterializationPlan,
  applyTerminalIntegrationPlan,
  applyContinuationWorkstreamMigrationPlan,
  analyzeRepositoryKnowledgeImpact,
  calculateKnowledgeReconciliationReviewPolicyVersion,
  canonicalJson,
  createKnowledgeDocumentDeletionPlan,
  createKnowledgeDocumentMergePlan,
  createKnowledgeDocumentMovePlan,
  createKnowledgeDocumentSplitPlan,
  createKnowledgeInstructionBridgePlan,
  createKnowledgeReconciliationPlan,
  createKnowledgeRefreshReviewCandidate,
  createSemanticKnowledgeMaterializationPlan,
  createKnowledgeMigrationPlan,
  createRepositoryLayoutMigrationPlan,
  createTerminalIntegrationPlan,
  createContinuationWorkstreamMigrationPlan,
  lintRepositoryKnowledge,
  inspectConfiguredDocumentNormalization,
  queryRepositoryKnowledge,
  scanConfiguredRepositoryKnowledge,
  sha256,
  loadKnowledgeReconciliationReviewPolicy,
  reviewKnowledgeReconciliation,
  recoverKnowledgeMaterialization,
  RepositoryKnowledgeError,
  serializableKnowledgeDocumentDeletionPlan,
  serializableKnowledgeDocumentMergePlan,
  serializableKnowledgeDocumentMovePlan,
  serializableKnowledgeDocumentSplitPlan,
  serializableKnowledgeInstructionBridgePlan,
  serializableRepositoryLayoutMigrationPlan,
  serializableTerminalIntegrationPlan,
  applyKnowledgeDocumentDeletionPlan,
  type KnowledgeMigrationPlan,
  type RepositoryLayoutMigrationPlan,
} from "@lervo/repository-knowledge";
import {
  applyOkfImportPlan,
  createOkfImportPlan,
  exportRepositoryKnowledgeToOkf,
  lintOkfBundle,
  queryOkfBundle,
  reExportOkfImportCandidate,
} from "@lervo/knowledge-okf";
import { openProjectStorage } from "@lervo/project-storage";
import { stringify } from "yaml";

import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import { runKnowledgeCompilationCommand } from "./knowledge-compilation-command.js";
import { runDocumentNormalizationCommand } from "./document-normalization-command.js";
import type { CliIo } from "./types.js";

export const knowledgeUsage = `  lervo knowledge refresh [--root <path>] [--apply <plan-id>] [--json]
  lervo knowledge impact [--root <path>] [--json]
  lervo knowledge refresh-candidate [--root <path>] [--json]
  lervo knowledge compile --provider <codex|claude> [--root <path>] [--model <model>] [--executable <path>] [--timeout-ms <ms>] [--json]
  lervo knowledge compare --codex <compilation-id> --claude <compilation-id> [--root <path>] [--json]
  lervo knowledge stability --provider <codex|claude> [--root <path>] [--model <model>] [--executable <path>] [--timeout-ms <ms>] [--json]
  lervo knowledge stability --baseline <compilation-id> --candidate <compilation-id> [--root <path>] [--json]
  lervo knowledge merge-candidate --comparison <comparison-id> --codex <compilation-id> --claude <compilation-id> [--root <path>] [--json]
  lervo knowledge normalize (--provider <codex|claude>|--candidate <candidate-id>) [--root <path>] [--model <model>] [--executable <path>] [--timeout-ms <ms>] [--apply <plan-id> --approve-item <operation-id>=<approval-hash>] [--json]
  lervo knowledge reconcile [--root <path>] [--json] <compilation-id>
  lervo knowledge review-policy --reviewer <id> [--policy-id <id>] [--allow-conflict-resolution] [--root <path>] [--write] [--json]
  lervo knowledge review --plan <plan-id> --policy <relative-path> --reviewer <id> (--accept-all-safe|--approve-item <disposition-id>=<output-hash>|--resolve-item <disposition-id>=<resolution-hash>|--reject) [--approve-item ...] [--resolve-item ...] [--root <path>] [--json] <compilation-id>
  lervo knowledge materialize [--root <path>] [--apply <plan-id>] [--json] <review-id>
  lervo knowledge materialize --recover [--root <path>] [--json]
  lervo knowledge structure delete <relative-markdown-path> [--root <path>] [--apply <plan-id> --approve-item <operation-id>=<approval-hash>] [--json]
  lervo knowledge structure move <from-relative-markdown-path> <to-relative-markdown-path> [--root <path>] [--apply <plan-id> --approve-item <operation-id>=<approval-hash>] [--json]
  lervo knowledge structure merge <source-relative-markdown-path> <destination-relative-markdown-path> [--root <path>] [--apply <plan-id> --approve-item <operation-id>=<approval-hash>] [--json]
  lervo knowledge structure split <source-relative-markdown-path> <destination-relative-markdown-path> --at-heading <heading-locator> [--root <path>] [--apply <plan-id> --approve-item <operation-id>=<approval-hash>] [--json]
  lervo knowledge instruction bridge --provider claude [--root <path>] [--apply <plan-id> --approve-item <operation-id>=<approval-hash>] [--json]
  lervo knowledge export okf --output <new-path> [--root <path>] [--json]
  lervo knowledge import okf <bundle-path> [--root <path>] [--apply <plan-id>] [--json]
  lervo knowledge okf lint <bundle-path> [--json]
  lervo knowledge okf query <bundle-path> <query> [--json]
  lervo knowledge okf re-export <candidate-id> --output <new-path> [--root <path>] [--json]
  lervo knowledge lint [--root <path>] [--json]
  lervo knowledge query [--root <path>] [--json] <query>`;

async function runKnowledgeOkfExchange(args: string[], io: CliIo): Promise<number> {
  try {
    const command = args[0];
    if (command === "export") {
      const parsed = parseArgs({ args: args.slice(1), strict: true, allowPositionals: true, options: { root: { type: "string" }, output: { type: "string" }, json: { type: "boolean" } } });
      if (parsed.positionals.length !== 1 || parsed.positionals[0] !== "okf" || parsed.values.output === undefined) throw new Error("export requires okf and --output <new-path>.");
      const result = await exportRepositoryKnowledgeToOkf({ repositoryRoot: resolve(io.cwd, parsed.values.root ?? "."), outputRoot: resolve(io.cwd, parsed.values.output) });
      io.stdout(parsed.values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Exported the OKF v0.2 bundle to a new path.\noutput: ${result.outputRoot}\nbundle: ${result.bundleDigest}\nconcept ${result.conceptCount} · file ${result.fileCount}\nNative publications and sidecars were not changed.\n`);
      return 0;
    }
    if (command === "import") {
      const parsed = parseArgs({ args: args.slice(1), strict: true, allowPositionals: true, options: { root: { type: "string" }, apply: { type: "string" }, json: { type: "boolean" } } });
      if (parsed.positionals.length !== 2 || parsed.positionals[0] !== "okf") throw new Error("import requires okf and a bundle path.");
      const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
      const bundleRoot = resolve(io.cwd, parsed.positionals[1]!);
      const plan = await createOkfImportPlan({ repositoryRoot, bundleRoot });
      if (parsed.values.apply === undefined) {
        io.stdout(parsed.values.json
          ? `${JSON.stringify(plan, null, 2)}\n`
          : `OKF import plan: ${plan.status}\nplan: ${plan.planId}\nbundle: ${plan.bundleDigest}\nfile ${plan.fileCount} · concept ${plan.conceptCount} · unknown metadata concept ${plan.unknownMetadataConceptCount}\n${plan.externalHumanVerifiedCount} externally human-verified concepts remain local assurance unreviewed.\nNo files or events have been changed. Use --apply ${plan.planId} to apply.\n`);
        return 0;
      }
      const receipt = await applyOkfImportPlan({ repositoryRoot, bundleRoot, planId: parsed.values.apply });
      io.stdout(parsed.values.json
        ? `${JSON.stringify(receipt, null, 2)}\n`
        : `OKF import candidate ${receipt.created ? "recorded" : "reused"}.\ncandidate: ${receipt.candidateId}\npath: ${receipt.candidatePath}\nExternal verification remains local assurance unreviewed. Publications and events were not changed.\n`);
      return 0;
    }
    if (command === "okf") {
      const operation = args[1];
      if (operation === "lint") {
        const parsed = parseArgs({ args: args.slice(2), strict: true, allowPositionals: true, options: { json: { type: "boolean" } } });
        if (parsed.positionals.length !== 1) throw new Error("okf lint requires one bundle path.");
        const result = await lintOkfBundle(resolve(io.cwd, parsed.positionals[0]!));
        io.stdout(parsed.values.json ? `${JSON.stringify(result, null, 2)}\n` : `OKF lint: ${result.valid ? "passed" : "failed"} · concept ${result.checkedConcepts}\n${result.issues.map((item) => `  [${item.code}] ${item.message}`).join("\n")}${result.issues.length === 0 ? "" : "\n"}`);
        return result.valid ? 0 : 1;
      }
      if (operation === "query") {
        const parsed = parseArgs({ args: args.slice(2), strict: true, allowPositionals: true, options: { json: { type: "boolean" } } });
        if (parsed.positionals.length < 2) throw new Error("okf query requires a bundle path and query.");
        const result = await queryOkfBundle({ bundleRoot: resolve(io.cwd, parsed.positionals[0]!), query: parsed.positionals.slice(1).join(" ") });
        io.stdout(parsed.values.json ? `${JSON.stringify(result, null, 2)}\n` : `OKF query recommendations: ${result.hits.length} (not evidence of use)\n${result.hits.map((hit) => `  ${hit.score} ${hit.title} · ${hit.externalTrust}/local unreviewed`).join("\n")}${result.hits.length === 0 ? "" : "\n"}`);
        return 0;
      }
      if (operation === "re-export") {
        const parsed = parseArgs({ args: args.slice(2), strict: true, allowPositionals: true, options: { root: { type: "string" }, output: { type: "string" }, json: { type: "boolean" } } });
        if (parsed.positionals.length !== 1 || parsed.values.output === undefined) throw new Error("okf re-export requires a candidate ID and --output <new-path>.");
        const result = await reExportOkfImportCandidate({ repositoryRoot: resolve(io.cwd, parsed.values.root ?? "."), candidateId: parsed.positionals[0]!, outputRoot: resolve(io.cwd, parsed.values.output) });
        io.stdout(parsed.values.json ? `${JSON.stringify(result, null, 2)}\n` : `Exported the preserved OKF candidate as a byte-identical bundle.\noutput: ${result.outputRoot}\nbundle: ${result.bundleDigest} · file ${result.fileCount}\n`);
        return 0;
      }
    }
    throw new Error("Unsupported OKF exchange command.");
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
    return 1;
  }
}

async function runKnowledgeReviewPolicy(args: string[], io: CliIo): Promise<number> {
  try {
    const parsed = parseArgs({ args, strict: true, allowPositionals: false, options: { root: { type: "string" }, reviewer: { type: "string" }, "policy-id": { type: "string" }, "allow-conflict-resolution": { type: "boolean" }, write: { type: "boolean" }, json: { type: "boolean" } } });
    if (parsed.values.reviewer === undefined) throw new Error("--reviewer is required.");
    if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(parsed.values.reviewer)) throw new Error("The reviewer ID format is invalid.");
    const policyId = parsed.values["policy-id"] ?? "knowledge_semantic_review.default";
    if (!/^knowledge_[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(policyId)) throw new Error("The policy ID format is invalid.");
    const conflictDisposition = parsed.values["allow-conflict-resolution"] === true ? "hash_bound_resolution" as const : "skip_only" as const;
    const materials = { schemaVersion: 1 as const, policyId, allowedReviewerIds: [parsed.values.reviewer], requireCompleteDispositionReview: true as const, conflictDisposition };
    const policy = { ...materials, policyVersion: calculateKnowledgeReconciliationReviewPolicyVersion(materials) };
    const content = `${stringify(policy, { lineWidth: 0, sortMapEntries: true })}`;
    const relativePath = `.lervo/knowledge/review-policies/${policyId}.yaml`;
    if (parsed.values.write) {
      const root = resolve(io.cwd, parsed.values.root ?? ".");
      const directory = resolve(root, ".lervo/knowledge/review-policies");
      try { await mkdir(directory, { mode: 0o700 }); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const directoryStats = await lstat(directory);
      if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) throw new Error("The review policy directory is not a safe physical directory. Run lervo init again first.");
      let handle;
      try {
        handle = await open(resolve(root, relativePath), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
        await handle.writeFile(content);
        await handle.sync();
      } finally { await handle?.close(); }
    }
    io.stdout(parsed.values.json ? `${JSON.stringify({ policy, path: relativePath, written: parsed.values.write === true }, null, 2)}\n` : `${parsed.values.write ? `Review policy created: ${relativePath}` : content}\n${parsed.values.write ? `policyVersion: ${policy.policyVersion}\n` : ""}`);
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
    return 1;
  }
}

async function runKnowledgeReview(args: string[], io: CliIo): Promise<number> {
  try {
    const parsed = parseArgs({ args, strict: true, allowPositionals: true, options: { root: { type: "string" }, plan: { type: "string" }, policy: { type: "string" }, reviewer: { type: "string" }, "accept-all-safe": { type: "boolean" }, "approve-item": { type: "string", multiple: true }, "resolve-item": { type: "string", multiple: true }, reject: { type: "boolean" }, json: { type: "boolean" } } });
    if (parsed.positionals.length !== 1 || parsed.values.plan === undefined || parsed.values.policy === undefined || parsed.values.reviewer === undefined) throw new Error("review requires a compilation ID plus --plan, --policy, and --reviewer.");
    const itemApprovals = (parsed.values["approve-item"] ?? []).map((value) => {
      const match = /^(kdisp_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/.exec(value);
      if (match === null) throw new Error("--approve-item must use <disposition-id>=<sha256-output-hash>.");
      return { dispositionId: match[1]!, action: "apply_managed_block_patch" as const, outputHash: match[2]! };
    });
    const conflictResolutions = (parsed.values["resolve-item"] ?? []).map((value) => {
      const match = /^(kdisp_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/.exec(value);
      if (match === null) throw new Error("--resolve-item must use <disposition-id>=<sha256-resolution-hash>.");
      return { dispositionId: match[1]!, action: "resolve_conflict" as const, resolutionHash: match[2]! };
    });
    const approvals = [...itemApprovals, ...conflictResolutions];
    const rejecting = parsed.values.reject === true;
    const approving = parsed.values["accept-all-safe"] === true || approvals.length > 0;
    if (rejecting === approving) throw new Error("Choose either --accept-all-safe/--approve-item/--resolve-item approval or --reject.");
    const root = resolve(io.cwd, parsed.values.root ?? ".");
    const compilationId = parsed.positionals[0] as string;
    const supplementalSources = await collectLocalKnowledgeSources(root);
    const [plan, policy] = await Promise.all([
      createKnowledgeReconciliationPlan({ repositoryRoot: root, compilationId, supplementalSources }),
      loadKnowledgeReconciliationReviewPolicy({ repositoryRoot: root, policyPath: parsed.values.policy }),
    ]);
    const safeIds = parsed.values["accept-all-safe"] === true
      ? plan.dispositions.filter((item) => item.action !== "conflict" && item.action !== "propose_user_patch").map((item) => item.dispositionId)
      : [];
    const acceptedDispositionIds = rejecting ? [] : [...new Set([...safeIds, ...approvals.map((item) => item.dispositionId)])];
    const skippedDispositionIds = plan.dispositions.filter((item) => !acceptedDispositionIds.includes(item.dispositionId)).map((item) => item.dispositionId);
    const storage = await openProjectStorage(root);
    try {
      const identity = randomUUID().replaceAll("-", "");
      const result = await reviewKnowledgeReconciliation({ repositoryRoot: root, compilationId, reconciliationPlanId: parsed.values.plan, policy, reviewerId: parsed.values.reviewer, decision: rejecting ? "rejected" : "approved", acceptedDispositionIds, skippedDispositionIds, itemApprovals: approvals, reviewedAt: new Date(), runId: `run_${identity}`, sessionId: `ses_${identity}`, createEventId: () => `evt_${identity}`, artifacts: storage.artifacts, events: storage.events, supplementalSources });
      io.stdout(parsed.values.json ? `${JSON.stringify({ review: result.review, artifact: result.artifact, eventId: result.eventId }, null, 2)}\n` : `Semantic reconciliation review recorded.\nreview: ${result.review.reviewId}\ndecision: ${result.review.decision} · accepted ${result.review.acceptedDispositionIds.length}, skipped ${result.review.skippedDispositionIds.length} · exact user-byte approvals ${result.review.itemApprovals.length}\nReviewer identity and approved paths and content remain only in the local CAS source; the event records digests only.\n`);
    } finally { await storage.close(); }
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
    return 1;
  }
}

async function runKnowledgeSemanticMaterialize(args: string[], io: CliIo): Promise<number> {
  try {
    const parsed = parseArgs({ args, strict: true, allowPositionals: true, options: { root: { type: "string" }, apply: { type: "string" }, recover: { type: "boolean" }, json: { type: "boolean" } } });
    if (parsed.values.recover) {
      if (parsed.positionals.length !== 0 || parsed.values.apply !== undefined) throw new Error("--recover cannot be combined with a review ID or --apply.");
      const root = resolve(io.cwd, parsed.values.root ?? ".");
      const storage = await openProjectStorage(root);
      try {
        const recovered = await recoverKnowledgeMaterialization({ repositoryRoot: root, eventRecorded: (planId) => storage.events.list().some((event) => event.type === "knowledge.materialization.applied" && event.payload.planId === planId) });
        io.stdout(parsed.values.json ? `${JSON.stringify(recovered, null, 2)}\n` : `Knowledge materialization transaction recovered: ${recovered.disposition === "rolled_back" ? "changes before the event were rolled back" : "recorded event outputs were retained and markers removed"}\nplan: ${recovered.planId}\n`);
      } finally { await storage.close(); }
      return 0;
    }
    if (parsed.positionals.length !== 1) throw new Error("materialize requires one review ID.");
    const root = resolve(io.cwd, parsed.values.root ?? ".");
    const supplementalSources = await collectLocalKnowledgeSources(root);
    const storage = await openProjectStorage(root);
    try {
      const plan = await createSemanticKnowledgeMaterializationPlan({ repositoryRoot: root, reviewId: parsed.positionals[0] as string, artifacts: storage.artifacts, events: storage.events, supplementalSources });
      if (parsed.values.apply === undefined) {
        const printable = { ...plan, operations: plan.operations.map(({ content: _content, ...operation }) => operation) };
        io.stdout(parsed.values.json ? `${JSON.stringify(printable, null, 2)}\n` : `Semantic materialization: ${plan.status}\nplan: ${plan.planId}\nreview: ${plan.reviewId}\nconcept created ${plan.createdConceptIds.length}, linked existing ${plan.updatedConceptIds.length}, claims ${plan.claimIds.length}, relations ${plan.relationIds.length}\nApproved user managed-block patches: ${plan.userPatchCount}\nNo files have been changed. Use --apply ${plan.planId} to apply.\n`);
        return plan.status === "ready" ? 0 : 1;
      }
      if (parsed.values.apply !== plan.planId) throw new Error("The requested plan ID does not match the current semantic materialization plan.");
      if (storage.events.list().some((event) => event.type === "knowledge.materialization.applied" && event.payload.planId === plan.planId)) throw new Error("The same semantic materialization plan was already applied.");
      const identity = randomUUID().replaceAll("-", "");
      const receipt = await applySemanticKnowledgeMaterializationPlan({ plan, artifacts: storage.artifacts, events: storage.events, now: new Date(), supplementalSources, recordApplied: async (applied) => {
        const validation = await lintRepositoryKnowledge(root, { allowTransactionPlanId: plan.planId, supplementalSources });
        if (!validation.valid) throw new RepositoryKnowledgeError("knowledge_apply_failed", `Deterministic lint failed after semantic materialization: ${[...new Set(validation.issues.map((issue) => issue.code))].sort().join(",")}`);
        const validationHash = sha256(canonicalJson(validation));
        await storage.artifacts.put(canonicalJson(validation));
        storage.events.append({ eventId: `evt_${identity}`, projectId: plan.projectId, runId: `run_${identity}`, sessionId: `ses_${identity}`, type: "knowledge.materialization.applied", occurredAt: applied.appliedAt, actor: { kind: "system" }, schemaVersion: 1, policyVersion: plan.policyHash, payload: { operation: "semantic", planId: plan.planId, sourceSnapshotId: plan.sourceSnapshotId, policyHash: plan.policyHash, compilerId: plan.compiler.compilerId, compilerVersion: plan.compiler.compilerVersion, compilerBuildId: plan.compiler.compilerBuildId, approvalDigest: plan.reviewArtifactHash, coverage: plan.coverage, bundleIds: [], createdConceptIds: plan.createdConceptIds.slice(0, 256), updatedConceptIds: plan.updatedConceptIds.slice(0, 256), deprecatedConceptIds: [], conceptListTruncated: plan.createdConceptIds.length + plan.updatedConceptIds.length > 256, resultArtifactId: null, resultArtifactHash: null, createdCount: applied.created.length, updatedCount: applied.updated.length, unchangedCount: applied.unchanged.length, beforeRegistryDigest: plan.registryDigest, afterRegistryDigest: sha256(canonicalJson(plan.operations.map((item) => ({ pathDigest: sha256(item.path), hash: item.desiredHash })))), validationReportId: `klint_${validationHash.slice(7, 31)}`, validationReportHash: validationHash, appliedAt: applied.appliedAt } });
      } });
      io.stdout(parsed.values.json ? `${JSON.stringify(receipt, null, 2)}\n` : `Materialized reviewed semantic knowledge. Created ${receipt.created.length}, updated ${receipt.updated.length}, unchanged ${receipt.unchanged.length}\nApplied user managed-block patches: ${plan.userPatchCount}\n`);
      return 0;
    } finally { await storage.close(); }
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
    return 1;
  }
}

async function runKnowledgeStructure(args: string[], io: CliIo): Promise<number> {
  try {
    const structureOperation = args[0];
    if (structureOperation !== "delete" && structureOperation !== "move" && structureOperation !== "merge" && structureOperation !== "split") throw new Error("The structure command supports delete, move, merge, and split.");
    const parsed = parseArgs({
      args: args.slice(1),
      strict: true,
      allowPositionals: true,
      options: { root: { type: "string" }, apply: { type: "string" }, "approve-item": { type: "string" }, "at-heading": { type: "string" }, json: { type: "boolean" } },
    });
    if (structureOperation === "move" && parsed.positionals.length !== 2) throw new Error("structure move requires source and destination repository-relative Markdown paths.");
    if (structureOperation === "merge" && parsed.positionals.length !== 2) throw new Error("structure merge requires source and destination repository-relative Markdown paths.");
    if (structureOperation === "split" && (parsed.positionals.length !== 2 || parsed.values["at-heading"] === undefined)) throw new Error("structure split requires source, destination, and --at-heading <heading-locator>.");
    if (structureOperation !== "split" && parsed.values["at-heading"] !== undefined) throw new Error("--at-heading may be used only with structure split.");
    if (structureOperation === "delete" && parsed.positionals.length !== 1) throw new Error("structure delete requires one repository-relative Markdown path.");
    const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
    const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
    if (structureOperation === "move") {
      const plan = await createKnowledgeDocumentMovePlan({ repositoryRoot, fromPath: parsed.positionals[0]!, toPath: parsed.positionals[1]!, supplementalSources });
      if (parsed.values.apply === undefined) {
        if (parsed.values["approve-item"] !== undefined) throw new Error("--approve-item must be used with --apply.");
        io.stdout(parsed.values.json
          ? `${JSON.stringify(serializableKnowledgeDocumentMovePlan(plan), null, 2)}\n`
          : `User document move review plan created.\nplan: ${plan.planId}\noperation: ${plan.operationId}\nsource: ${plan.document.fromPath} · ${plan.document.contentHash} · ${plan.document.byteCount} bytes\ndestination: ${plan.document.toPath}\npreserved concepts: ${plan.preservedConceptIds.length}\napproval: ${plan.operationId}=${plan.approvalHash}\nDocuments, sidecars, and navigation have not been changed.\n`);
        return 0;
      }
      if (parsed.values.apply !== plan.planId) throw new Error("The requested plan ID does not match the current document move plan.");
      const approval = /^(kdocop_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/.exec(parsed.values["approve-item"] ?? "");
      if (approval === null) throw new Error("--approve-item must use <operation-id>=<sha256-approval-hash>.");
      const storage = await openProjectStorage(repositoryRoot);
      try {
        if (storage.events.list().some((event) => event.type === "knowledge.materialization.applied" && event.payload.planId === plan.planId)) throw new Error("The same document move plan was already applied.");
        const identity = randomUUID().replaceAll("-", "");
        const receipt = await applyKnowledgeDocumentMovePlan({
          plan,
          approvedOperationId: approval[1]!,
          approvedHash: approval[2]!,
          now: new Date(),
          supplementalSources,
          recordApplied: async (applied) => {
            const validation = await lintRepositoryKnowledge(repositoryRoot, { allowTransactionPlanId: plan.planId, supplementalSources });
            if (!validation.valid) throw new Error("Deterministic lint failed after the document move.");
            const validationArtifact = await storage.artifacts.put(canonicalJson(validation));
            storage.events.append({
              eventId: `evt_${identity}`,
              projectId: plan.projectId,
              runId: `run_${identity}`,
              sessionId: `ses_${identity}`,
              type: "knowledge.materialization.applied",
              occurredAt: applied.appliedAt,
              actor: { kind: "user" },
              schemaVersion: 1,
              policyVersion: plan.policyHash,
              payload: {
                operation: "document_structure_move",
                planId: plan.planId,
                sourceSnapshotId: plan.sourceSnapshotId,
                policyHash: plan.policyHash,
                compilerId: "lervo.document-structure",
                compilerVersion: "1",
                approvalDigest: plan.approvalHash,
                coverage: plan.coverage,
                bundleIds: [],
                createdConceptIds: plan.createdConceptIds.slice(0, 256),
                updatedConceptIds: plan.updatedConceptIds.slice(0, 256),
                deprecatedConceptIds: plan.deprecatedConceptIds.slice(0, 256),
                conceptListTruncated: plan.createdConceptIds.length + plan.updatedConceptIds.length + plan.deprecatedConceptIds.length > 256,
                resultArtifactId: null,
                resultArtifactHash: null,
                createdCount: plan.operations.filter((item) => item.action === "create").length,
                updatedCount: plan.operations.filter((item) => item.action === "update").length + 1,
                unchangedCount: plan.operations.filter((item) => item.action === "unchanged").length,
                beforeRegistryDigest: plan.registryDigest,
                afterRegistryDigest: plan.afterRegistryDigest,
                validationReportId: `klint_${validationArtifact.contentHash.slice("sha256:".length, "sha256:".length + 24)}`,
                validationReportHash: validationArtifact.contentHash,
                appliedAt: applied.appliedAt,
              },
            });
          },
        });
        io.stdout(parsed.values.json ? `${JSON.stringify(receipt, null, 2)}\n` : `Moved the user document while preserving concept identity and source-unit lineage.\nplan: ${receipt.planId}\npreserved concepts: ${receipt.preservedConceptIds.length}\nsource digest: ${receipt.fromPathDigest}\ndestination digest: ${receipt.toPathDigest}\n`);
      } finally { await storage.close(); }
      return 0;
    }
    if (structureOperation === "merge") {
      const plan = await createKnowledgeDocumentMergePlan({ repositoryRoot, sourcePath: parsed.positionals[0]!, destinationPath: parsed.positionals[1]!, supplementalSources });
      if (parsed.values.apply === undefined) {
        if (parsed.values["approve-item"] !== undefined) throw new Error("--approve-item must be used with --apply.");
        io.stdout(parsed.values.json
          ? `${JSON.stringify(serializableKnowledgeDocumentMergePlan(plan), null, 2)}\n`
          : `User document merge review plan created.\nplan: ${plan.planId}\noperation: ${plan.operationId}\nsource: ${plan.source.path} · ${plan.source.contentHash} · ${plan.source.byteCount} bytes\ndestination: ${plan.destination.path} · ${plan.destination.beforeHash} → ${plan.destination.afterHash}\ncomposition: destination_then_source\ndeprecated concepts: ${plan.deprecatedConceptIds.length}\napproval: ${plan.operationId}=${plan.approvalHash}\nDocuments, lineage, sidecars, and navigation have not been changed.\n`);
        return 0;
      }
      if (parsed.values.apply !== plan.planId) throw new Error("The requested plan ID does not match the current document merge plan.");
      const approval = /^(kdocop_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/.exec(parsed.values["approve-item"] ?? "");
      if (approval === null) throw new Error("--approve-item must use <operation-id>=<sha256-approval-hash>.");
      const storage = await openProjectStorage(repositoryRoot);
      try {
        if (storage.events.list().some((event) => event.type === "knowledge.materialization.applied" && event.payload.planId === plan.planId)) throw new Error("The same document merge plan was already applied.");
        const identity = randomUUID().replaceAll("-", "");
        const receipt = await applyKnowledgeDocumentMergePlan({
          plan,
          approvedOperationId: approval[1]!,
          approvedHash: approval[2]!,
          now: new Date(),
          supplementalSources,
          recordApplied: async (applied) => {
            const validation = await lintRepositoryKnowledge(repositoryRoot, { allowTransactionPlanId: plan.planId, supplementalSources });
            if (!validation.valid) throw new Error("Deterministic lint failed after the document merge.");
            const validationArtifact = await storage.artifacts.put(canonicalJson(validation));
            storage.events.append({
              eventId: `evt_${identity}`,
              projectId: plan.projectId,
              runId: `run_${identity}`,
              sessionId: `ses_${identity}`,
              type: "knowledge.materialization.applied",
              occurredAt: applied.appliedAt,
              actor: { kind: "user" },
              schemaVersion: 1,
              policyVersion: plan.policyHash,
              payload: {
                operation: "document_structure_merge",
                planId: plan.planId,
                sourceSnapshotId: plan.sourceSnapshotId,
                policyHash: plan.policyHash,
                compilerId: "lervo.document-structure",
                compilerVersion: "1",
                approvalDigest: plan.approvalHash,
                coverage: plan.coverage,
                bundleIds: [],
                createdConceptIds: plan.createdConceptIds.slice(0, 256),
                updatedConceptIds: plan.updatedConceptIds.slice(0, 256),
                deprecatedConceptIds: plan.deprecatedConceptIds.slice(0, 256),
                conceptListTruncated: plan.createdConceptIds.length + plan.updatedConceptIds.length + plan.deprecatedConceptIds.length > 256,
                resultArtifactId: null,
                resultArtifactHash: null,
                createdCount: plan.operations.filter((item) => item.action === "create").length,
                updatedCount: plan.operations.filter((item) => item.action === "update").length,
                unchangedCount: plan.operations.filter((item) => item.action === "unchanged").length,
                beforeRegistryDigest: plan.registryDigest,
                afterRegistryDigest: plan.afterRegistryDigest,
                validationReportId: `klint_${validationArtifact.contentHash.slice("sha256:".length, "sha256:".length + 24)}`,
                validationReportHash: validationArtifact.contentHash,
                appliedAt: applied.appliedAt,
              },
            });
          },
        });
        io.stdout(parsed.values.json ? `${JSON.stringify(receipt, null, 2)}\n` : `Merged the source document into the destination byte-for-byte and updated knowledge navigation.\nplan: ${receipt.planId}\nmerged bytes: ${receipt.mergedByteCount}\nsource digest: ${receipt.sourcePathDigest}\ndestination digest: ${receipt.destinationPathDigest}\n`);
      } finally { await storage.close(); }
      return 0;
    }
    if (structureOperation === "split") {
      const plan = await createKnowledgeDocumentSplitPlan({ repositoryRoot, sourcePath: parsed.positionals[0]!, destinationPath: parsed.positionals[1]!, headingLocator: parsed.values["at-heading"]!, supplementalSources });
      if (parsed.values.apply === undefined) {
        if (parsed.values["approve-item"] !== undefined) throw new Error("--approve-item must be used with --apply.");
        io.stdout(parsed.values.json
          ? `${JSON.stringify(serializableKnowledgeDocumentSplitPlan(plan), null, 2)}\n`
          : `User document split review plan created.\nplan: ${plan.planId}\noperation: ${plan.operationId}\nsource: ${plan.source.path} · ${plan.source.beforeHash} → ${plan.source.afterHash}\ndestination: ${plan.destination.path} · ${plan.destination.contentHash}\nheading: ${plan.heading.locator} · byte ${plan.heading.startByte}..${plan.heading.endByte}\napproval: ${plan.operationId}=${plan.approvalHash}\nDocuments, lineage, sidecars, and navigation have not been changed.\n`);
        return 0;
      }
      if (parsed.values.apply !== plan.planId) throw new Error("The requested plan ID does not match the current document split plan.");
      const approval = /^(kdocop_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/.exec(parsed.values["approve-item"] ?? "");
      if (approval === null) throw new Error("--approve-item must use <operation-id>=<sha256-approval-hash>.");
      const storage = await openProjectStorage(repositoryRoot);
      try {
        if (storage.events.list().some((event) => event.type === "knowledge.materialization.applied" && event.payload.planId === plan.planId)) throw new Error("The same document split plan was already applied.");
        const identity = randomUUID().replaceAll("-", "");
        const receipt = await applyKnowledgeDocumentSplitPlan({
          plan,
          approvedOperationId: approval[1]!,
          approvedHash: approval[2]!,
          now: new Date(),
          supplementalSources,
          recordApplied: async (applied) => {
            const validation = await lintRepositoryKnowledge(repositoryRoot, { allowTransactionPlanId: plan.planId, supplementalSources });
            if (!validation.valid) throw new Error("Deterministic lint failed after the document split.");
            const validationArtifact = await storage.artifacts.put(canonicalJson(validation));
            storage.events.append({
              eventId: `evt_${identity}`,
              projectId: plan.projectId,
              runId: `run_${identity}`,
              sessionId: `ses_${identity}`,
              type: "knowledge.materialization.applied",
              occurredAt: applied.appliedAt,
              actor: { kind: "user" },
              schemaVersion: 1,
              policyVersion: plan.policyHash,
              payload: {
                operation: "document_structure_split",
                planId: plan.planId,
                sourceSnapshotId: plan.sourceSnapshotId,
                policyHash: plan.policyHash,
                compilerId: "lervo.document-structure",
                compilerVersion: "1",
                approvalDigest: plan.approvalHash,
                coverage: plan.coverage,
                bundleIds: [],
                createdConceptIds: plan.createdConceptIds.slice(0, 256),
                updatedConceptIds: plan.updatedConceptIds.slice(0, 256),
                deprecatedConceptIds: plan.deprecatedConceptIds.slice(0, 256),
                conceptListTruncated: plan.createdConceptIds.length + plan.updatedConceptIds.length + plan.deprecatedConceptIds.length > 256,
                resultArtifactId: null,
                resultArtifactHash: null,
                createdCount: plan.operations.filter((item) => item.action === "create").length,
                updatedCount: plan.operations.filter((item) => item.action === "update").length,
                unchangedCount: plan.operations.filter((item) => item.action === "unchanged").length,
                beforeRegistryDigest: plan.registryDigest,
                afterRegistryDigest: plan.afterRegistryDigest,
                validationReportId: `klint_${validationArtifact.contentHash.slice("sha256:".length, "sha256:".length + 24)}`,
                validationReportHash: validationArtifact.contentHash,
                appliedAt: applied.appliedAt,
              },
            });
          },
        });
        io.stdout(parsed.values.json ? `${JSON.stringify(receipt, null, 2)}\n` : `Split the heading subtree into a new user document and updated knowledge navigation.\nplan: ${receipt.planId}\nextracted bytes: ${receipt.extractedByteCount}\nsource digest: ${receipt.sourcePathDigest}\ndestination digest: ${receipt.destinationPathDigest}\n`);
      } finally { await storage.close(); }
      return 0;
    }
    const plan = await createKnowledgeDocumentDeletionPlan({ repositoryRoot, documentPath: parsed.positionals[0]!, supplementalSources });
    if (parsed.values.apply === undefined) {
      if (parsed.values["approve-item"] !== undefined) throw new Error("--approve-item must be used with --apply.");
      io.stdout(parsed.values.json
        ? `${JSON.stringify(serializableKnowledgeDocumentDeletionPlan(plan), null, 2)}\n`
        : `User document deletion review plan created.\nplan: ${plan.planId}\noperation: ${plan.operationId}\ntarget: ${plan.document.path} · ${plan.document.contentHash} · ${plan.document.byteCount} bytes\ndeprecated concepts: ${plan.deprecatedConceptIds.length}\napproval: ${plan.operationId}=${plan.approvalHash}\nDocuments and sidecars have not been changed.\n`);
      return 0;
    }
    if (parsed.values.apply !== plan.planId) throw new Error("The requested plan ID does not match the current document structure plan.");
    const approval = /^(kdocop_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/.exec(parsed.values["approve-item"] ?? "");
    if (approval === null) throw new Error("--approve-item must use <operation-id>=<sha256-approval-hash>.");
    const storage = await openProjectStorage(repositoryRoot);
    try {
      if (storage.events.list().some((event) => event.type === "knowledge.materialization.applied" && event.payload.planId === plan.planId)) throw new Error("The same document structure plan was already applied.");
      const identity = randomUUID().replaceAll("-", "");
      const receipt = await applyKnowledgeDocumentDeletionPlan({
        plan,
        approvedOperationId: approval[1]!,
        approvedHash: approval[2]!,
        now: new Date(),
        supplementalSources,
        recordApplied: async (applied) => {
          const validation = await lintRepositoryKnowledge(repositoryRoot, { allowTransactionPlanId: plan.planId, supplementalSources });
          if (!validation.valid) throw new Error("Deterministic lint failed after document deletion.");
          const validationBytes = canonicalJson(validation);
          const validationArtifact = await storage.artifacts.put(validationBytes);
          storage.events.append({
            eventId: `evt_${identity}`,
            projectId: plan.projectId,
            runId: `run_${identity}`,
            sessionId: `ses_${identity}`,
            type: "knowledge.materialization.applied",
            occurredAt: applied.appliedAt,
            actor: { kind: "user" },
            schemaVersion: 1,
            policyVersion: plan.policyHash,
            payload: {
              operation: "document_structure_delete",
              planId: plan.planId,
              sourceSnapshotId: plan.sourceSnapshotId,
              policyHash: plan.policyHash,
              compilerId: "lervo.document-structure",
              compilerVersion: "1",
              approvalDigest: plan.approvalHash,
              coverage: plan.coverage,
              bundleIds: [],
              createdConceptIds: [],
              updatedConceptIds: [],
              deprecatedConceptIds: plan.deprecatedConceptIds,
              conceptListTruncated: false,
              resultArtifactId: null,
              resultArtifactHash: null,
              createdCount: 0,
              updatedCount: applied.updatedSidecars.length,
              unchangedCount: 0,
              beforeRegistryDigest: plan.registryDigest,
              afterRegistryDigest: plan.afterRegistryDigest,
              validationReportId: `klint_${validationArtifact.contentHash.slice("sha256:".length, "sha256:".length + 24)}`,
              validationReportHash: validationArtifact.contentHash,
              appliedAt: applied.appliedAt,
            },
          });
        },
      });
      io.stdout(parsed.values.json ? `${JSON.stringify(receipt, null, 2)}\n` : `Deleted the user document and deprecated linked concepts.\nplan: ${receipt.planId}\ndeprecated concepts: ${receipt.deprecatedConceptIds.length}\npath digest: ${receipt.deletedPathDigest}\n`);
    } finally { await storage.close(); }
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
    return 1;
  }
}

async function runKnowledgeInstruction(args: string[], io: CliIo): Promise<number> {
  try {
    if (args[0] !== "bridge") throw new Error("The instruction command currently supports bridge.");
    const parsed = parseArgs({
      args: args.slice(1),
      strict: true,
      allowPositionals: false,
      options: {
        root: { type: "string" },
        provider: { type: "string" },
        apply: { type: "string" },
        "approve-item": { type: "string" },
        json: { type: "boolean" },
      },
    });
    if (parsed.values.provider !== "claude") throw new Error("The first instruction bridge profile requires --provider claude.");
    const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
    const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
    const plan = await createKnowledgeInstructionBridgePlan({ repositoryRoot, provider: "claude", supplementalSources });
    if (parsed.values.apply === undefined) {
      if (parsed.values["approve-item"] !== undefined) throw new Error("--approve-item must be used with --apply.");
      io.stdout(parsed.values.json
        ? `${JSON.stringify(serializableKnowledgeInstructionBridgePlan(plan), null, 2)}\n`
        : plan.status === "current"
          ? `The Claude instruction bridge matches the current profile.\nprofile: ${plan.profile.profileId}\ncanonical: ${plan.canonical.path} · ${plan.canonical.contentHash}\ntarget: ${plan.target.path} · ${plan.target.afterHash}\n`
          : plan.status === "ready"
            ? `The Claude instruction bridge target is current; a derived record/navigation update plan was created.\nplan: ${plan.planId}\nprofile: ${plan.profile.profileId}\nUse --apply ${plan.planId} to apply. Item approval is not required.\n`
            : `Claude instruction bridge review plan created.\nplan: ${plan.planId}\noperation: ${plan.operationId}\nprofile: ${plan.profile.profileId}\ncanonical: ${plan.canonical.path} · ${plan.canonical.contentHash}\ntarget: ${plan.target.action} ${plan.target.path} · ${plan.target.beforeHash ?? "absent"} → ${plan.target.afterHash}\napproval: ${plan.operationId}=${plan.approvalHash}\nInstructions, bridge records, concepts, and navigation have not been changed.\n`);
      return 0;
    }
    if (plan.status === "current") throw new Error("The instruction bridge is already current; there are no changes to apply.");
    if (parsed.values.apply !== plan.planId) throw new Error("The requested plan ID does not match the current instruction bridge plan.");
    const approval = parsed.values["approve-item"] === undefined ? null : /^(kinstop_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/.exec(parsed.values["approve-item"]);
    if (plan.status === "review_required" && approval === null) throw new Error("--approve-item must use <operation-id>=<sha256-approval-hash>.");
    if (plan.status === "ready" && parsed.values["approve-item"] !== undefined) throw new Error("Do not use --approve-item for a ready plan with no user-target change.");
    const storage = await openProjectStorage(repositoryRoot);
    try {
      if (storage.events.list().some((event) => event.type === "knowledge.materialization.applied" && event.payload.planId === plan.planId)) throw new Error("The same instruction bridge plan was already applied.");
      const identity = randomUUID().replaceAll("-", "");
      const receipt = await applyKnowledgeInstructionBridgePlan({
        plan,
        ...(approval === null ? {} : { approvedOperationId: approval[1]!, approvedHash: approval[2]! }),
        now: new Date(),
        supplementalSources,
        recordApplied: async (applied) => {
          const validation = await lintRepositoryKnowledge(repositoryRoot, { allowTransactionPlanId: plan.planId, supplementalSources });
          if (!validation.valid) throw new RepositoryKnowledgeError("knowledge_apply_failed", `Deterministic lint failed after the instruction bridge: ${[...new Set(validation.issues.map((issue) => issue.code))].sort().join(",")}`);
          const validationArtifact = await storage.artifacts.put(canonicalJson(validation));
          storage.events.append({
            eventId: `evt_${identity}`,
            projectId: plan.projectId,
            runId: `run_${identity}`,
            sessionId: `ses_${identity}`,
            type: "knowledge.materialization.applied",
            occurredAt: applied.appliedAt,
            actor: { kind: "user" },
            schemaVersion: 1,
            policyVersion: plan.policyHash,
            payload: {
              operation: "instruction_bridge_update",
              planId: plan.planId,
              sourceSnapshotId: plan.sourceSnapshotId,
              policyHash: plan.policyHash,
              compilerId: "lervo.instruction-bridge",
              compilerVersion: `${plan.profile.profileId}@${plan.profile.profileVersion}`,
              approvalDigest: plan.status === "review_required" ? plan.approvalHash : null,
              coverage: plan.coverage,
              bundleIds: [],
              createdConceptIds: plan.createdConceptIds.slice(0, 256),
              updatedConceptIds: plan.updatedConceptIds.slice(0, 256),
              deprecatedConceptIds: [],
              conceptListTruncated: plan.createdConceptIds.length + plan.updatedConceptIds.length > 256,
              resultArtifactId: null,
              resultArtifactHash: null,
              createdCount: plan.operations.filter((item) => item.action === "create").length,
              updatedCount: plan.operations.filter((item) => item.action === "update").length,
              unchangedCount: plan.operations.filter((item) => item.action === "unchanged").length,
              beforeRegistryDigest: plan.registryDigest,
              afterRegistryDigest: plan.afterRegistryDigest,
              validationReportId: `klint_${validationArtifact.contentHash.slice("sha256:".length, "sha256:".length + 24)}`,
              validationReportHash: validationArtifact.contentHash,
              appliedAt: applied.appliedAt,
            },
          });
        },
      });
      io.stdout(parsed.values.json
        ? `${JSON.stringify(receipt, null, 2)}\n`
        : `Applied the Claude instruction bridge and updated knowledge navigation.\nplan: ${receipt.planId}\nprofile: ${receipt.profileId}\ncanonical digest: ${receipt.canonicalPathDigest}\ntarget digest: ${receipt.targetPathDigest}\n`);
    } finally {
      await storage.close();
    }
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
    return 1;
  }
}

function printablePlan(plan: KnowledgeMigrationPlan): unknown {
  return {
    ...plan,
    operations: plan.operations.map((operation) => operation.action === "delete" ? operation : (({ content: _content, ...value }) => value)(operation)),
  };
}

function formatRepositoryLayoutMigrationPlan(plan: RepositoryLayoutMigrationPlan): string {
  const lines = [
    `Repository document-layout migration target: ${plan.repositoryRoot}`,
    `Plan ID: ${plan.planId}`,
    `Plan status: ${plan.status === "review_required" ? "item approvals required" : plan.status === "ready" ? "ready" : plan.status === "current" ? "current" : "blocked"}`,
    `Document moves: ${plan.moves.length}`,
    `User-document updates: ${plan.userUpdates.length}`,
    `Machine-artifact moves: ${plan.machineMoves.length}`,
    `Reference updates: ${plan.referenceUpdates.length}`,
  ];
  for (const move of plan.moves) {
    lines.push(`  ${move.fromPath} -> ${move.toPath} (${move.classification})`, `  approval: ${move.operationId}=${move.approvalHash}`);
  }
  for (const update of plan.userUpdates) {
    lines.push(`  ${update.path} (${update.reason})`, `  approval: ${update.operationId}=${update.approvalHash}`);
  }
  for (const blocker of plan.blockers) {
    const details = [
      blocker.candidateRouteIds === undefined ? "" : ` candidates=${blocker.candidateRouteIds.join(",")}`,
      blocker.observedCount === undefined ? "" : ` count=${blocker.observedCount}/${blocker.configuredMaximum}`,
    ].join("");
    lines.push(`  blocker [${blocker.code}] ${blocker.path ?? blocker.pathDigest}${details}`);
  }
  if (plan.status === "review_required") lines.push("No files have been changed.", `To apply, use --apply ${plan.planId} with every displayed --approve-item.`);
  if (plan.status === "ready") lines.push("No files have been changed.", `To apply, use --apply ${plan.planId}.`);
  return `${lines.join("\n")}\n`;
}

function parseLayoutApprovals(values: string[] | undefined): Array<{ operationId: string; approvalHash: string }> {
  return (values ?? []).map((value) => {
    const match = /^(kdocop_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/u.exec(value);
    if (match === null) throw new Error("--approve-item must use <operation-id>=<approval-hash>.");
    return { operationId: match[1]!, approvalHash: match[2]! };
  });
}

export function formatKnowledgeMigrationPlan(plan: KnowledgeMigrationPlan): string {
  const counts = new Map<string, number>();
  for (const operation of plan.operations) counts.set(operation.action, (counts.get(operation.action) ?? 0) + 1);
  const lines = [
    `Repository knowledge ${plan.mode === "refresh" ? "refresh" : "migration"} target: ${plan.repositoryRoot}`,
    `Plan ID: ${plan.planId}`,
    `Plan status: ${plan.status === "ready" ? "ready to apply" : "blocked"}`,
    `source snapshot: ${plan.sourceSnapshotId}`,
    `coverage: included ${plan.coverage.included}, excluded ${plan.coverage.excluded}, unsupported ${plan.coverage.unsupported}`,
    `Existing user documents registered: ${plan.registeredUserDocuments} (bytes unchanged)`,
    `Concepts generated: ${plan.generatedConcepts}`,
    `Agent surfaces: ${plan.agentArtifacts.total} (semantic source ${plan.agentArtifacts.semanticSources}, local inventory only ${plan.agentArtifacts.localInventoryOnly}, review ${plan.agentArtifacts.reviewRequired}, nonstandard ${plan.agentArtifacts.nonstandard})`,
    `semantic impact: stale ${plan.impact.stale}, unknown ${plan.impact.unknown}, affected concepts ${plan.impact.affectedConcepts} (report ${plan.impactReportId})`,
    `File plan: create ${counts.get("create") ?? 0}, update ${counts.get("update") ?? 0}, delete ${counts.get("delete") ?? 0}, unchanged ${counts.get("unchanged") ?? 0}, conflict ${counts.get("conflict") ?? 0}`,
  ];
  for (const operation of plan.operations.filter((item) => item.action === "conflict")) {
    lines.push(`  conflict ${operation.path}: ${operation.reason ?? "Existing bytes will be preserved."}`);
  }
  for (const artifact of plan.agentArtifacts.items.filter((item) =>
    item.migrationDisposition === "portable_skill_review" ||
    item.migrationDisposition === "workflow_review" ||
    item.migrationDisposition === "provider_specific_review")) {
    lines.push(`  review required ${artifact.path}: ${artifact.provider}/${artifact.role} (${artifact.migrationDisposition})`);
  }
  for (const artifact of plan.agentArtifacts.items.filter((item) =>
    item.discovery === "not_standard" || item.discovery === "not_current_standard")) {
    lines.push(`  preserved nonstandard ${artifact.path}: no automatic discovery claim (${artifact.profileId})`);
  }
  if (plan.status === "ready" && plan.operations.some((operation) => operation.action !== "unchanged")) {
    lines.push("No files have been changed.", `Run again with --apply ${plan.planId} to apply this plan.`);
  }
  return `${lines.join("\n")}\n`;
}

export async function runKnowledgeMigration(input: {
  args: string[];
  io: CliIo;
  mode: "migrate" | "refresh";
}): Promise<number> {
  let values: { root?: string; apply?: string; "approve-item"?: string[]; "continuation-source"?: string; provider?: string; candidate?: string; model?: string; executable?: string; "timeout-ms"?: string; json?: boolean; help?: boolean };
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
    input.io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
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
          ...(values["continuation-source"] === undefined ? {} : { sourcePath: values["continuation-source"] }),
          supplementalSources,
        });
      } finally {
        await projectStorage.close();
      }
      if (continuation.status !== "current") {
        if (values.apply === undefined) {
          if ((values["approve-item"]?.length ?? 0) > 0) throw new Error("--approve-item must be used with --apply.");
          input.io.stdout(values.json
            ? `${JSON.stringify({ ...continuation, operations: continuation.operations.map((operation) => {
                if (!("content" in operation)) return operation;
                const { content: _content, ...printable } = operation;
                return printable;
              }) }, null, 2)}\n`
            : continuation.status === "blocked"
              ? `Continuation workstream migration is blocked.\n${continuation.blockers.map((item) => `  [${item.code}] ${item.message}`).join("\n")}\n${continuation.candidates.map((item) => `  candidate: ${item.path} score=${item.score} signals=${item.signals.join(",")}`).join("\n")}\n`
              : `Continuation workstream migration review plan created.\nplan: ${continuation.planId}\nworkstream: ${continuation.workstream?.workstreamId}\nsource: ${continuation.sourcePath} (${continuation.sourceContentHash})\nreferences updated: ${continuation.referenceUpdates.length}\nnormalization records retired: ${continuation.removedNormalizationRecords.length}\napproval: ${continuation.operationId}=${continuation.approvalHash}\nNo files or state have been changed.\n`);
          return continuation.status === "blocked" ? 1 : 0;
        }
        if (continuation.status === "blocked") throw new Error("The continuation workstream migration is blocked.");
        if (values.apply !== continuation.planId) throw new Error("The requested plan ID does not match the current continuation workstream migration plan.");
        if ((values["approve-item"]?.length ?? 0) !== 1) throw new Error("Continuation workstream migration requires one exact --approve-item value.");
        const approval = /^(kwstreamop_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/u.exec(values["approve-item"]![0]!);
        if (approval === null) throw new Error("--approve-item must use <operation-id>=<sha256-approval-hash>.");
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
              if (sourceArtifact.contentHash !== applied.sourceContentHash || snapshotArtifact.contentHash !== applied.snapshotContentHash) {
                throw new RepositoryKnowledgeError("knowledge_apply_failed", "The persisted workstream artifacts differ from the migration bindings.");
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
          input.io.stdout(values.json
            ? `${JSON.stringify(receipt, null, 2)}\n`
            : `Migrated ${continuation.sourcePath} into Lervo workstream state.\nworkstream: ${receipt.workstreamId}\nreferences updated: ${receipt.referenceUpdatedCount}\nRun lervo migrate knowledge again to refresh canonical documentation and navigation.\n`);
        } finally {
          await storage.close();
        }
        return 0;
      }
    }
    const layout = input.mode === "migrate" ? await createRepositoryLayoutMigrationPlan({ repositoryRoot, supplementalSources }) : null;
    if (layout !== null && layout.status !== "current") {
      if (values.apply === undefined) {
        if ((values["approve-item"]?.length ?? 0) > 0) throw new Error("--approve-item must be used with --apply.");
        input.io.stdout(values.json ? `${JSON.stringify(serializableRepositoryLayoutMigrationPlan(layout), null, 2)}\n` : formatRepositoryLayoutMigrationPlan(layout));
        return layout.status === "review_required" || layout.status === "ready" ? 0 : 1;
      }
      if (values.apply !== layout.planId) throw new Error("The requested plan ID does not match the current repository layout plan.");
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
            const validation = await lintRepositoryKnowledge(layout.repositoryRoot, { allowTransactionPlanId: layout.planId, supplementalSources });
            if (!validation.valid) {
              const issueCodes = [...new Set(validation.issues.map((issue) => issue.code))].sort().join(",");
              throw new RepositoryKnowledgeError("knowledge_apply_failed", `Deterministic lint failed after repository layout migration: ${issueCodes}`);
            }
            const validationHash = sha256(canonicalJson(validation));
            await storage.artifacts.put(canonicalJson(validation));
            const conceptChanges = layout.operations
              .map((operation) => ({ operation, match: /^\.lervo\/knowledge\/concepts\/(?:[a-f0-9]{2}\/)?(concept_[a-f0-9]{24})\.yaml$/.exec(operation.path) }))
              .filter((item): item is { operation: typeof layout.operations[number]; match: RegExpExecArray } => item.match !== null);
            const createdConceptIds = conceptChanges.filter((item) => item.operation.action === "create").map((item) => item.match[1] as string).slice(0, 256);
            const updatedConceptIds = conceptChanges.filter((item) => item.operation.action === "update").map((item) => item.match[1] as string).slice(0, 256);
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
                afterRegistryDigest: sha256(canonicalJson(layout.operations.map((item) => ({ pathDigest: sha256(item.path), hash: item.action === "move" ? item.expectedCurrentHash : item.desiredHash })))),
                validationReportId: `klint_${validationHash.slice("sha256:".length, "sha256:".length + 24)}`,
                validationReportHash: validationHash,
                appliedAt: applied.appliedAt,
              },
            });
          },
        });
      } finally { await storage.close(); }
      input.io.stdout(values.json ? `${JSON.stringify(receipt, null, 2)}\n` : `Repository document-layout migration completed.\nplan: ${receipt.planId}\nDocument moves: ${receipt.movedCount}\nMachine-artifact moves: ${receipt.machineMovedCount}\nReference updates: ${receipt.referenceUpdatedCount}\n`);
      return 0;
    }
    let hasClaudeEntrypoint = false;
    try { hasClaudeEntrypoint = (await lstat(resolve(repositoryRoot, "CLAUDE.md"))).isFile(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (input.mode === "migrate" && hasClaudeEntrypoint) {
      const bridge = await createKnowledgeInstructionBridgePlan({ repositoryRoot, provider: "claude", supplementalSources });
      if (bridge.status !== "current") {
        if ((values["approve-item"]?.length ?? 0) > 1) throw new Error("The Claude instruction bridge accepts one exact --approve-item value.");
        return runKnowledgeInstruction([
          "bridge",
          "--provider", "claude",
          "--root", repositoryRoot,
          ...(values.apply === undefined ? [] : ["--apply", values.apply]),
          ...(values["approve-item"]?.[0] === undefined ? [] : ["--approve-item", values["approve-item"][0]]),
          ...(values.json ? ["--json"] : []),
        ], input.io);
      }
    }
    const plan = await createKnowledgeMigrationPlan({
      repositoryRoot,
      mode: input.mode,
      supplementalSources,
    });
    const structuralCurrent = plan.operations.every((operation) => operation.action === "unchanged");
    if (input.mode === "migrate" && structuralCurrent) {
      const bridge = await createKnowledgeInstructionBridgePlan({ repositoryRoot, provider: "claude", supplementalSources });
      if (bridge.status !== "current") {
        if ((values["approve-item"]?.length ?? 0) > 1) throw new Error("The Claude instruction bridge accepts one exact --approve-item value.");
        return runKnowledgeInstruction([
          "bridge",
          "--provider", "claude",
          "--root", repositoryRoot,
          ...(values.apply === undefined ? [] : ["--apply", values.apply]),
          ...(values["approve-item"]?.[0] === undefined ? [] : ["--approve-item", values["approve-item"][0]]),
          ...(values.json ? ["--json"] : []),
        ], input.io);
      }
    }
    if (input.mode === "migrate" && structuralCurrent) {
      const terminal = await createTerminalIntegrationPlan(repositoryRoot);
      if (terminal.status !== "current") {
        if (values.apply === undefined) {
          if ((values["approve-item"]?.length ?? 0) > 0) throw new Error("--approve-item must be used with --apply.");
          input.io.stdout(values.json
            ? `${JSON.stringify(serializableTerminalIntegrationPlan(terminal), null, 2)}\n`
            : terminal.status === "blocked"
              ? `Terminal integration migration is blocked.\n${terminal.blockers.map((item) => `  ${item.provider} [${item.code}] ${item.path}`).join("\n")}\nExisting provider settings and hooks were not changed.\n`
              : `Terminal integration review plan created.\nplan: ${terminal.planId}\ncontract: ${terminal.contractId}\ntargets:\n${terminal.targets.map((item) => `  ${item.provider}: ${item.action} ${item.path} · ${item.beforeHash ?? "absent"} → ${item.afterHash ?? "blocked"}`).join("\n")}\napproval: ${terminal.operationId}=${terminal.approvalHash}\nExisting provider settings and hooks have not been changed.\n`);
          return terminal.status === "blocked" ? 1 : 0;
        }
        if (terminal.status === "blocked") throw new Error("The terminal integration plan is blocked; provider configuration must be reviewed before apply.");
        if (values.apply !== terminal.planId) throw new Error("The requested plan ID does not match the current terminal integration plan.");
        if ((values["approve-item"]?.length ?? 0) !== 1) throw new Error("Terminal integration requires one exact --approve-item value.");
        const approval = /^(ktermop_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/u.exec(values["approve-item"]![0]!);
        if (approval === null) throw new Error("--approve-item must use <operation-id>=<sha256-approval-hash>.");
        const storage = await openProjectStorage(repositoryRoot);
        try {
          if (storage.events.list().some((event) => event.type === "terminal.integration.applied" && event.payload.planId === terminal.planId)) throw new Error("The same terminal integration plan was already applied.");
          const identity = randomUUID().replaceAll("-", "");
          const receipt = await applyTerminalIntegrationPlan({
            plan: terminal,
            approvedOperationId: approval[1]!,
            approvedHash: approval[2]!,
            now: new Date(),
            recordApplied: (applied) => {
              storage.events.append({
                eventId: `evt_${identity}`,
                projectId: terminal.projectId,
                runId: `run_${identity}`,
                sessionId: `ses_${identity}`,
                type: "terminal.integration.applied",
                occurredAt: applied.appliedAt,
                actor: { kind: "user" },
                schemaVersion: 1,
                policyVersion: terminal.approvalHash,
                payload: {
                  operation: applied.operation,
                  planId: applied.planId,
                  contractId: applied.contractId,
                  providers: terminal.providers,
                  targetPathDigests: applied.targetDigests.map((item) => item.pathDigest),
                  targetAfterHashes: applied.targetDigests.map((item) => item.afterHash),
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
              instruction: "Open Codex in this repository, run /hooks, then review and trust the Lervo UserPromptSubmit and Stop command hooks. Codex skips untrusted project hooks.",
            },
            verification: "Run lervo terminal status after one prompt and one completed turn in each installed provider.",
          };
          input.io.stdout(values.json
            ? `${JSON.stringify({ ...receipt, activation }, null, 2)}\n`
            : `Applied the Codex and Claude terminal integration without replacing existing provider hooks.\nplan: ${receipt.planId}\ncontract: ${receipt.contractId}\nACTION REQUIRED ONCE FOR CODEX: ${activation.requiredOnce.instruction}\nVERIFY: ${activation.verification}\n`);
        } finally {
          await storage.close();
        }
        return 0;
      }
    }
    if (input.mode === "migrate" && structuralCurrent) {
      if (values.provider !== undefined || values.candidate !== undefined) {
        return runDocumentNormalizationCommand([
          ...(values.provider === undefined ? [] : ["--provider", values.provider]),
          ...(values.candidate === undefined ? [] : ["--candidate", values.candidate]),
          "--root", repositoryRoot,
          ...(values.model === undefined ? [] : ["--model", values.model]),
          ...(values.executable === undefined ? [] : ["--executable", values.executable]),
          ...(values["timeout-ms"] === undefined ? [] : ["--timeout-ms", values["timeout-ms"]]),
          ...(values.apply === undefined ? [] : ["--apply", values.apply]),
          ...(values["approve-item"] ?? []).flatMap((approval) => ["--approve-item", approval]),
          ...(values.json ? ["--json"] : []),
        ], input.io);
      }
      if (values.apply === undefined) {
        const normalization = await inspectConfiguredDocumentNormalization({ repositoryRoot, supplementalSources });
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
          input.io.stdout(values.json
            ? `${JSON.stringify(result, null, 2)}\n`
            : `Repository content normalization requires an installed provider.\npending documents: ${normalization.pendingDocuments.length}/${normalization.eligibleDocuments}\nlanguage: ${normalization.outputLanguage} · format: ${normalization.formatVersion}\nRun lervo migrate knowledge --provider codex (or claude) to create the reviewable rewrite candidate.\n`);
          return 0;
        }
      }
    }
    if ((values["approve-item"]?.length ?? 0) > 0) throw new Error("The current migration plan does not require item approvals.");
    if (values.apply === undefined) {
      input.io.stdout(values.json ? `${JSON.stringify(printablePlan(plan), null, 2)}\n` : formatKnowledgeMigrationPlan(plan));
      return plan.status === "ready" ? 0 : 1;
    }
    if (values.apply !== plan.planId) {
      input.io.stderr("The requested plan ID does not match the current read-only plan. A source or target may have changed; review the plan again.\n");
      return 1;
    }
    const storage = await openProjectStorage(plan.repositoryRoot);
    let receipt;
    try {
      const eventIdentity = randomUUID().replaceAll("-", "");
      receipt = await applyKnowledgeMigrationPlan(plan, new Date(), async (applied) => {
        const validation = await lintRepositoryKnowledge(plan.repositoryRoot, { supplementalSources });
        if (!validation.valid) throw new Error("Deterministic lint failed after materialization.");
        const validationHash = sha256(canonicalJson(validation));
        await storage.artifacts.put(canonicalJson(validation));
        const conceptChanges = plan.operations
          .map((operation) => ({ operation, match: /^\.lervo\/knowledge\/concepts\/(concept_[a-f0-9]{24})\.yaml$/.exec(operation.path) }))
          .filter((item): item is { operation: typeof plan.operations[number]; match: RegExpExecArray } => item.match !== null)
          .map((item) => ({ conceptId: item.match[1] as string, action: item.operation.action }));
        const createdConceptIds = conceptChanges.filter((item) => item.action === "create").map((item) => item.conceptId);
        const updatedConceptIds = conceptChanges.filter((item) => item.action === "update").map((item) => item.conceptId);
        const deprecatedConceptIds = conceptChanges.filter((item) => item.action === "delete").map((item) => item.conceptId);
        const boundedConceptIds = [...createdConceptIds, ...updatedConceptIds, ...deprecatedConceptIds].slice(0, 256);
        const overflow = createdConceptIds.length + updatedConceptIds.length + deprecatedConceptIds.length > 256
          ? await storage.artifacts.put(canonicalJson({ createdConceptIds, updatedConceptIds, deprecatedConceptIds }))
          : null;
        const bundleIds = plan.operations
          .map((item) => /^\.lervo\/knowledge\/bundles\/(bundle_[a-f0-9]{24})\.yaml$/.exec(item.path)?.[1])
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
            deprecatedConceptIds: boundedConceptIds.filter((id) => deprecatedConceptIds.includes(id)),
            conceptListTruncated: overflow !== null,
            resultArtifactId: overflow === null ? null : `art_${overflow.contentHash.slice("sha256:".length)}`,
            resultArtifactHash: overflow?.contentHash ?? null,
            createdCount: applied.created.length,
            updatedCount: applied.updated.length,
            unchangedCount: applied.unchanged.length,
            deletedCount: applied.deleted.length,
            beforeRegistryDigest: sha256(canonicalJson(plan.operations.map((item) => ({ pathDigest: sha256(item.path), hash: item.expectedCurrentHash ?? null })))),
            afterRegistryDigest: sha256(canonicalJson(plan.operations.map((item) => ({ pathDigest: sha256(item.path), hash: item.action === "delete" ? null : item.desiredHash })))),
            validationReportId: `klint_${validationHash.slice("sha256:".length, "sha256:".length + 24)}`,
            validationReportHash: validationHash,
            appliedAt: applied.appliedAt,
          },
        });
      }, { supplementalSources });
    } finally {
      await storage.close();
    }
    input.io.stdout(values.json
      ? `${JSON.stringify(receipt, null, 2)}\n`
      : `Repository knowledge materialized. Created ${receipt.created.length}, updated ${receipt.updated.length}, unchanged ${receipt.unchanged.length}\nsource snapshot: ${receipt.sourceSnapshotId}\n`);
    return 0;
  } catch (error) {
    input.io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export async function runKnowledgeCommand(args: string[], io: CliIo): Promise<number> {
  const subcommand = args[0];
  if (subcommand === "export" || subcommand === "import" || subcommand === "okf") return runKnowledgeOkfExchange(args, io);
  if (subcommand === "refresh") return runKnowledgeMigration({ args: args.slice(1), io, mode: "refresh" });
  if (subcommand === "impact") {
    try {
      const parsed = parseArgs({ args: args.slice(1), strict: true, allowPositionals: false, options: { root: { type: "string" }, json: { type: "boolean" } } });
      const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
      const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
      const { scan } = await scanConfiguredRepositoryKnowledge(repositoryRoot, { supplementalSources });
      const report = await analyzeRepositoryKnowledgeImpact({ repositoryRoot, scan });
      io.stdout(parsed.values.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : `Repository knowledge impact: ${report.status} · current ${report.summary.current} · stale ${report.summary.stale} · unknown ${report.summary.unknown} · affected concepts ${report.summary.affectedConcepts}\nreport: ${report.reportId} · source snapshot: ${report.sourceSnapshotId} · lineage ${report.lineageComplete ? "complete" : "incomplete"}\n${report.items.filter((item) => item.freshness !== "current").map((item) => `  ${item.freshness} ${item.subjectKind}:${item.subjectId} · ${item.reasons.join(", ")}`).join("\n")}${report.items.every((item) => item.freshness === "current") ? "" : "\n"}`);
      return 0;
    } catch (error) {
      io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
      return 1;
    }
  }
  if (subcommand === "refresh-candidate") {
    try {
      const parsed = parseArgs({ args: args.slice(1), strict: true, allowPositionals: false, options: { root: { type: "string" }, json: { type: "boolean" } } });
      const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
      const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
      const { scan } = await scanConfiguredRepositoryKnowledge(repositoryRoot, { supplementalSources });
      const report = await analyzeRepositoryKnowledgeImpact({ repositoryRoot, scan });
      const candidate = createKnowledgeRefreshReviewCandidate(report);
      io.stdout(parsed.values.json
        ? `${JSON.stringify(candidate, null, 2)}\n`
        : `Repository knowledge refresh review candidate: ${candidate.status} · items ${candidate.items.length}\ncandidate: ${candidate.candidateId} · impact: ${candidate.impactReportId}\n${candidate.items.map((item) => `  ${item.proposedAction} ${item.subjectKind}:${item.subjectId} · ${item.observedFreshness} · ${item.reasons.join(", ")}`).join("\n")}${candidate.items.length === 0 ? "" : "\n"}Publications were not changed automatically.\n`);
      return 0;
    } catch (error) {
      io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
      return 1;
    }
  }
  if (subcommand === "compile" || subcommand === "compare" || subcommand === "stability" || subcommand === "merge-candidate") {
    return runKnowledgeCompilationCommand({ operation: subcommand, args: args.slice(1), io, usage: knowledgeUsage });
  }
  if (subcommand === "normalize") return runDocumentNormalizationCommand(args.slice(1), io);
  if (subcommand === "review-policy") return runKnowledgeReviewPolicy(args.slice(1), io);
  if (subcommand === "review") return runKnowledgeReview(args.slice(1), io);
  if (subcommand === "materialize") return runKnowledgeSemanticMaterialize(args.slice(1), io);
  if (subcommand === "structure") return runKnowledgeStructure(args.slice(1), io);
  if (subcommand === "instruction") return runKnowledgeInstruction(args.slice(1), io);
  if (subcommand === "reconcile") {
    try {
      const parsed = parseArgs({ args: args.slice(1), strict: true, allowPositionals: true, options: { root: { type: "string" }, json: { type: "boolean" } } });
      if (parsed.positionals.length !== 1) throw new Error("reconcile requires one compilation ID.");
      const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
      const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
      const plan = await createKnowledgeReconciliationPlan({ repositoryRoot, compilationId: parsed.positionals[0] as string, supplementalSources });
      const counts = new Map<string, number>();
      for (const item of plan.dispositions) counts.set(item.action, (counts.get(item.action) ?? 0) + 1);
      io.stdout(parsed.values.json
        ? `${JSON.stringify(plan, null, 2)}\n`
        : `Semantic candidate reconciliation: ${plan.status}\nplan: ${plan.reconciliationPlanId}\nregister existing ${counts.get("register_existing") ?? 0}, create generated ${counts.get("create_generated") ?? 0}, add relation ${counts.get("add_relation") ?? 0}, proposed user patch ${counts.get("propose_user_patch") ?? 0}, conflict ${counts.get("conflict") ?? 0}\nreview required ${plan.dispositions.filter((item) => item.review === "review_required").length}\nThis plan is read-only and did not change publications or candidate assurance.\n`);
      return plan.status === "conflict" ? 1 : 0;
    } catch (error) {
      io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
      return 1;
    }
  }
  if (subcommand === "lint") {
    try {
      const parsed = parseArgs({ args: args.slice(1), strict: true, allowPositionals: false, options: { root: { type: "string" }, json: { type: "boolean" } } });
      const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
      const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
      const result = await lintRepositoryKnowledge(repositoryRoot, { supplementalSources });
      io.stdout(parsed.values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Repository knowledge lint: ${result.valid ? "passed" : "failed"} · concept ${result.checkedConcepts} · error ${result.issues.filter((item) => item.severity === "error").length} · warning ${result.issues.filter((item) => item.severity === "warning").length}\n${result.issues.map((item) => `  ${item.severity} [${item.code}] ${item.path}: ${item.message}`).join("\n")}${result.issues.length === 0 ? "" : "\n"}`);
      return result.valid ? 0 : 1;
    } catch (error) {
      io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
      return 1;
    }
  }
  if (subcommand === "query") {
    try {
      const parsed = parseArgs({ args: args.slice(1), strict: true, allowPositionals: true, options: { root: { type: "string" }, json: { type: "boolean" } } });
      const query = parsed.positionals.join(" ").trim();
      if (query === "") throw new Error("A query sentence is required.");
      const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
      const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
      const result = await queryRepositoryKnowledge({ repositoryRoot, query, supplementalSources });
      io.stdout(parsed.values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Repository knowledge recommendations (${result.hits.length}; not evidence of loaded, injected, or used)\n${result.hits.map((hit) => `  ${hit.score.toString().padStart(2)}  ${hit.title} · ${hit.path} · ${hit.freshness}`).join("\n")}${result.hits.length === 0 ? "" : "\n"}`);
      return 0;
    } catch (error) {
      io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
      return 1;
    }
  }
  io.stderr(`Specify a supported knowledge subcommand.\n${knowledgeUsage}\n`);
  return 1;
}
