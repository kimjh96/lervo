import type { ManagedProviderRunResult } from "@lervo/execution-contract";
import {
  assertNoKnowledgeMaterializationTransaction,
  createKnowledgeInstructionBootstrapPlan,
  createKnowledgeInstructionBridgePlan,
  createKnowledgeMigrationPlan,
  createRepositoryLayoutMigrationPlan,
  inspectConfiguredDocumentNormalization,
  lintRepositoryKnowledge,
  readCurrentWorkstreamState,
  scanConfiguredRepositoryKnowledge,
} from "@lervo/repository-knowledge";
import type { RemoteContinuationCoordinate } from "@lervo/schemas";

import { ManagedProviderHostError } from "./types.js";

async function assertKnowledgeCurrent(repositoryRoot: string): Promise<void> {
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
  if (
    bootstrap.status !== "not_applicable" ||
    layout.status !== "current" ||
    migration.operations.some((operation) => operation.action !== "unchanged") ||
    bridge.status !== "current" ||
    normalization.pendingDocuments.length > 0 ||
    !lint.valid
  ) {
    throw new ManagedProviderHostError(
      "managed_completion_invalid",
      "The managed provider run left repository knowledge migration, normalization, or lint incomplete.",
    );
  }
}

export async function verifyManagedProviderHostCompletion(input: {
  repositoryRoot: string;
  continuation: RemoteContinuationCoordinate | undefined;
  run: ManagedProviderRunResult;
}): Promise<void> {
  if (input.run.managedChanges.length === 0 || input.continuation === undefined) return;
  const current = await readCurrentWorkstreamState(input.repositoryRoot);
  if (
    current === null ||
    current.snapshot.workstreamId !== input.continuation.workstreamId ||
    current.snapshot.revision <= input.continuation.revision ||
    current.contentHash === input.continuation.snapshotContentHash
  ) {
    throw new ManagedProviderHostError(
      "managed_completion_invalid",
      "The repository changed without advancing the exact continued workstream.",
    );
  }
  await assertKnowledgeCurrent(input.repositoryRoot);
}
