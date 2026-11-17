import {
  repositoryLayoutDecision,
  type KnowledgeMigrationPlan,
  type RepositoryLayoutMigrationPlan,
} from "@lervo/repository-knowledge";

import { documentRouteDeferralLines } from "./document-route-deferral-attention.js";
import { formatRepositoryLayoutDecision } from "./knowledge-layout-decision.js";
import { layoutCapacityLines } from "./layout-capacity-lines.js";

export function printableKnowledgeMigrationPlan(plan: KnowledgeMigrationPlan): unknown {
  return {
    ...plan,
    operations: plan.operations.map((operation) =>
      operation.action === "delete"
        ? operation
        : (({ content: _content, ...value }) => value)(operation),
    ),
  };
}

export function formatRepositoryLayoutMigrationPlan(plan: RepositoryLayoutMigrationPlan): string {
  const lines = [
    `Deferred documents: ${plan.deferredDocumentCount}`,
    ...documentRouteDeferralLines(plan.deferredDocuments, "  "),
    `Repository document-layout migration target: ${plan.repositoryRoot}`,
    `Plan ID: ${plan.planId}`,
    `Plan status: ${plan.status === "review_required" ? "item approvals required" : plan.status === "ready" ? "ready" : plan.status === "current" ? "current" : "blocked"}`,
    `Document moves: ${plan.moves.length}`,
    `User-document updates: ${plan.userUpdates.length}`,
    `Machine-artifact moves: ${plan.machineMoves.length}`,
    `Reference updates: ${plan.referenceUpdates.length}`,
  ];
  for (const move of plan.moves) {
    lines.push(
      `  ${move.fromPath} -> ${move.toPath} (${move.classification}${move.classificationBasis === undefined ? "" : `; ${move.classificationBasis}`})`,
      `  approval: ${move.operationId}=${move.approvalHash}`,
    );
  }
  lines.push(...layoutCapacityLines(plan.layoutCapacity ?? [], ""));
  if (plan.retainedDocumentCount > 0)
    lines.push(
      `Retained in place: ${plan.retainedDocumentCount}`,
      ...plan.retainedDocuments.map((item) => `  ${item.path} (${item.basis})`),
    );
  for (const update of plan.userUpdates) {
    lines.push(
      `  ${update.path} (${update.reason})`,
      `  approval: ${update.operationId}=${update.approvalHash}`,
    );
  }
  for (const blocker of plan.blockers) {
    const details = [
      blocker.candidateRouteIds === undefined
        ? ""
        : ` candidates=${blocker.candidateRouteIds.join(",")}`,
      blocker.observedCount === undefined
        ? ""
        : ` count=${blocker.observedCount}/${blocker.configuredMaximum}`,
    ].join("");
    lines.push(`  blocker [${blocker.code}] ${blocker.path ?? blocker.pathDigest}${details}`);
  }
  const decision = repositoryLayoutDecision(plan);
  if (decision !== null)
    lines.push(...formatRepositoryLayoutDecision(decision, plan.repositoryRoot));
  if (plan.status === "review_required")
    lines.push(
      "No files have been changed.",
      decision === null
        ? `To apply, use --apply ${plan.planId} with every displayed --approve-item.`
        : `Accept or decline the layout decision above with one command, or use --apply ${plan.planId} with every displayed --approve-item.`,
    );
  if (plan.status === "ready")
    lines.push("No files have been changed.", `To apply, use --apply ${plan.planId}.`);
  return `${lines.join("\n")}\n`;
}

export function parseLayoutApprovals(
  values: string[] | undefined,
): Array<{ operationId: string; approvalHash: string }> {
  return (values ?? []).map((value) => {
    const match = /^(kdocop_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/u.exec(value);
    if (match === null) throw new Error("--approve-item must use <operation-id>=<approval-hash>.");
    return { operationId: match[1]!, approvalHash: match[2]! };
  });
}

function conflictExplanation(path: string, reason: string | undefined): string {
  if (reason !== "existing_bytes_are_not_a_recorded_lervo_generation")
    return reason ?? "Existing bytes will be preserved.";
  if (/^\.lervo\/knowledge\/(?:bundles|concepts)\//u.test(path))
    return "unrecorded generated record, often caused by a Git merge resolution; review `lervo knowledge refresh --rebuild`, then apply its exact plan";
  if (path.endsWith(".md"))
    return `the file lacks the Lervo generated header, so it is preserved as user-owned. Copy any content you need elsewhere, then restore the generated page with \`rm '${path}' && lervo knowledge refresh\` and apply its exact plan`;
  return "existing bytes are not a recorded Lervo generation and will be preserved";
}

/** Lines naming every reason a knowledge plan cannot apply. */
export function formatKnowledgeMigrationBlockers(plan: KnowledgeMigrationPlan): string[] {
  const lines: string[] = [];
  for (const blocker of plan.blockers) {
    lines.push(`  blocker [${blocker.code}] ${blocker.path}`);
    if (blocker.issues.length === 0) lines.push(`    ${blocker.message}`);
    for (const issue of blocker.issues)
      lines.push(
        `    [${issue.rule}]${issue.roleId === undefined ? "" : ` role=${issue.roleId}`} ${issue.message}`,
      );
  }
  for (const operation of plan.operations.filter((item) => item.action === "conflict"))
    lines.push(
      `  conflict ${operation.path}: ${conflictExplanation(operation.path, operation.reason)}`,
    );
  return lines;
}

export function formatKnowledgeMigrationPlan(plan: KnowledgeMigrationPlan): string {
  const counts = new Map<string, number>();
  for (const operation of plan.operations)
    counts.set(operation.action, (counts.get(operation.action) ?? 0) + 1);
  const lines = [
    `Repository knowledge ${plan.mode === "refresh" ? "refresh" : "migration"} target: ${plan.repositoryRoot}`,
    `Plan ID: ${plan.planId}`,
    `Plan status: ${plan.status === "ready" ? "ready to apply" : "blocked"}`,
    `Repair mode: ${plan.repairMode}`,
    `Reconciliation: ${plan.reconciliation.strategy} · changed ${plan.reconciliation.changedSourceCount} · reused ${plan.reconciliation.reusedSourceCount} · removed ${plan.reconciliation.removedSourceCount}`,
    `source snapshot: ${plan.sourceSnapshotId}`,
    `coverage: included ${plan.coverage.included}, excluded ${plan.coverage.excluded}, unsupported ${plan.coverage.unsupported}`,
    `Existing user documents registered: ${plan.registeredUserDocuments} (bytes unchanged)`,
    `Concepts generated: ${plan.generatedConcepts}`,
    `Agent surfaces: ${plan.agentArtifacts.total} (semantic source ${plan.agentArtifacts.semanticSources}, local inventory only ${plan.agentArtifacts.localInventoryOnly}, review ${plan.agentArtifacts.reviewRequired}, nonstandard ${plan.agentArtifacts.nonstandard})`,
    `semantic impact: stale ${plan.impact.stale}, unknown ${plan.impact.unknown}, affected concepts ${plan.impact.affectedConcepts} (report ${plan.impactReportId})`,
    `File plan: create ${counts.get("create") ?? 0}, update ${counts.get("update") ?? 0}, delete ${counts.get("delete") ?? 0}, unchanged ${counts.get("unchanged") ?? 0}, conflict ${counts.get("conflict") ?? 0}`,
  ];
  lines.push(...formatKnowledgeMigrationBlockers(plan));
  for (const operation of plan.operations.filter(
    (item) => item.reason === "regenerate_edited_generated_publication",
  ))
    lines.push(
      `  regenerate ${operation.path}: edited generated publication will be replaced by its rebuildable generated bytes`,
    );
  for (const artifact of plan.agentArtifacts.items.filter(
    (item) =>
      item.migrationDisposition === "portable_skill_review" ||
      item.migrationDisposition === "workflow_review" ||
      item.migrationDisposition === "provider_specific_review",
  )) {
    lines.push(
      `  review required ${artifact.path}: ${artifact.provider}/${artifact.role} (${artifact.migrationDisposition})`,
    );
  }
  for (const artifact of plan.agentArtifacts.items.filter(
    (item) => item.discovery === "not_standard" || item.discovery === "not_current_standard",
  )) {
    lines.push(
      `  preserved nonstandard ${artifact.path}: no automatic discovery claim (${artifact.profileId})`,
    );
  }
  if (
    plan.status === "ready" &&
    plan.operations.some((operation) => operation.action !== "unchanged")
  ) {
    lines.push(
      "No files have been changed.",
      `Run again with ${plan.repairMode === "replace_unrecorded_structural_records" ? "--rebuild " : ""}--apply ${plan.planId} to apply this plan.`,
    );
  }
  return `${lines.join("\n")}\n`;
}
