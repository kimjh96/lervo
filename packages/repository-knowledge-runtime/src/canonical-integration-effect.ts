import { inspectRetainedCanonicalIntegration } from "./canonical-integration-recovery.js";
import { prepareCanonicalGitIntegration } from "./canonical-integration-candidate.js";
import {
  canonicalJson,
  sha256,
  applyDurableKnowledgeOperations,
  authorizeCurrentRepositoryDocumentLayout,
  lintRepositoryKnowledge,
  validateKnowledgeStage,
  structuralKnowledgeLintCodes,
  type KnowledgeConvergenceInput,
  type DurableKnowledgeUserFileOperation,
} from "@lervo/repository-knowledge";
import type { CanonicalDraft } from "./canonical-assessment-contract.js";
import type { ConvergenceAssignmentAuthority } from "./workforce.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { recordConvergenceMaterialization } from "./materialization-event.js";
import { verifyConvergenceEffect } from "./stage-verification.js";

export async function integrateCanonicalWorkspace(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  authority: ConvergenceAssignmentAuthority,
  sealedWorkspaceId: string,
  drafts: CanonicalDraft[],
) {
  const root = context.storage.paths.repositoryRoot;
  const retained = await inspectRetainedCanonicalIntegration(context, state, drafts);
  const { plan, integration } = retained
    ? { plan: retained.plan, integration: retained.completion }
    : await prepareCanonicalGitIntegration(context, state, authority, sealedWorkspaceId);
  // The exact ref integration is necessary but insufficient: publish only the approved paths through the durable journal.
  const operations: DurableKnowledgeUserFileOperation[] = drafts.map((draft) => ({
    path: draft.path,
    action: draft.beforeHash === null ? "create" : "update",
    ownership: "user",
    mediaType: "text/markdown",
    content: draft.content,
    desiredHash: sha256(draft.content),
    ...(draft.beforeHash === null ? {} : { expectedCurrentHash: draft.beforeHash }),
  }));
  const planId = `kstruct_${sha256(canonicalJson([state.obligationId, plan.planId, operations])).slice(7, 31)}`;
  const before = await lintRepositoryKnowledge(root);
  const receipt = {
    schemaVersion: 1,
    obligationId: state.obligationId,
    planId,
    integration,
    operations: operations.map(({ path, desiredHash }) => ({ path, desiredHash })),
  };
  const documentLayoutPermit = await authorizeCurrentRepositoryDocumentLayout({
    repositoryRoot: root,
    operations,
  });
  await authority.assertCurrent();
  // No other await separates this fence from the first write.
  context.assertSourceExact(state);
  await applyDurableKnowledgeOperations({
    repositoryRoot: root,
    projectId: state.baseline.projectId,
    planId,
    operations,
    documentLayoutPermit,
    receipt,
    recordApplied: async (effect) => {
      await authority.assertCurrent();
      const validation = validateKnowledgeStage({
        stage: "canonical integration",
        before,
        after: await lintRepositoryKnowledge(root, { allowTransactionPlanId: planId }),
        ownedErrorCodes: structuralKnowledgeLintCodes,
      });
      const verification = await verifyConvergenceEffect(
        context,
        authority,
        state.baseline.policyHash,
      );
      await recordConvergenceMaterialization(context.storage, {
        operation: "canonicalize",
        planId,
        sourceSnapshotId: state.baseline.sourceSnapshotId,
        policyHash: state.baseline.policyHash,
        receipt: { ...effect, verification },
        created: operations
          .filter((operation) => operation.action === "create")
          .map((operation) => operation.path),
        updated: operations
          .filter((operation) => operation.action === "update")
          .map((operation) => operation.path),
        deleted: [],
        validation,
      });
    },
  });
  context.sourceObservation?.noteChange();
  return receipt;
}
