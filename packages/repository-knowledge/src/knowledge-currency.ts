import { createHash } from "node:crypto";

import { createKnowledgeInstructionBootstrapPlan } from "./instruction-bootstrap.js";
import { createKnowledgeInstructionBridgePlan } from "./instruction-bridge.js";
import { createKnowledgeMigrationPlan, scanConfiguredRepositoryKnowledge } from "./compiler.js";
import { createRepositoryLayoutMigrationPlan } from "./repository-layout-migration.js";
import { lintRepositoryKnowledge } from "./lint-query.js";
import { inspectConfiguredDocumentNormalization } from "./document-normalization.js";
import { assertNoKnowledgeMaterializationTransaction } from "./durable-apply.js";
import { listCanonicalizationCandidates } from "./canonicalization-candidate-record.js";

export type RepositoryKnowledgeCurrencyReason =
  | "instruction_bootstrap_pending"
  | "layout_migration_pending"
  | "knowledge_migration_pending"
  | "instruction_bridge_pending"
  | "normalization_pending"
  | "knowledge_lint_invalid"
  | "canonicalization_pending"
  | "knowledge_snapshot_changed";

/**
 * Read-only: whether managed knowledge is current, and the snapshot it was checked against. It
 * never applies a migration, so a background owner cannot rewrite a user's working tree.
 */
export async function inspectRepositoryKnowledgeCurrency(repositoryRoot: string): Promise<{
  current: boolean;
  snapshotHash: string;
  reasons: RepositoryKnowledgeCurrencyReason[];
}> {
  await assertNoKnowledgeMaterializationTransaction({ repositoryRoot });
  const { scan } = await scanConfiguredRepositoryKnowledge(repositoryRoot);
  const shared = { preparedScan: scan };
  const [bootstrap, layout, migration, bridge, normalization] = await Promise.all([
    createKnowledgeInstructionBootstrapPlan({ repositoryRoot, ...shared }),
    createRepositoryLayoutMigrationPlan({ repositoryRoot, ...shared }),
    createKnowledgeMigrationPlan({ repositoryRoot, mode: "migrate", ...shared }),
    createKnowledgeInstructionBridgePlan({ repositoryRoot, provider: "claude", ...shared }),
    inspectConfiguredDocumentNormalization({ repositoryRoot, ...shared }),
  ]);
  const lint = await lintRepositoryKnowledge(repositoryRoot, {
    ...shared,
    preparedNormalization: normalization,
  });
  const reasons: RepositoryKnowledgeCurrencyReason[] = [];
  if (bootstrap.status !== "not_applicable") reasons.push("instruction_bootstrap_pending");
  if (layout.status !== "current") reasons.push("layout_migration_pending");
  if (migration.operations.some((operation) => operation.action !== "unchanged"))
    reasons.push("knowledge_migration_pending");
  if (bridge.status !== "current") reasons.push("instruction_bridge_pending");
  if (normalization.pendingDocuments.length > 0) reasons.push("normalization_pending");
  if (!lint.valid) reasons.push("knowledge_lint_invalid");
  const candidates = await listCanonicalizationCandidates(repositoryRoot);
  if (
    candidates.some((candidate) =>
      ["candidate", "pending", "stale"].includes(candidate.observedState),
    )
  )
    reasons.push("canonicalization_pending");
  const after = await scanConfiguredRepositoryKnowledge(repositoryRoot);
  if (after.scan.snapshotId !== scan.snapshotId) reasons.push("knowledge_snapshot_changed");
  return {
    current: reasons.length === 0,
    snapshotHash: `sha256:${createHash("sha256").update(scan.snapshotId).digest("hex")}`,
    reasons,
  };
}
