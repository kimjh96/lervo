import { scanCompleteConfiguredRepositoryKnowledge } from "@lervo/repository-knowledge";
import { resolveConvergenceCandidates } from "./candidate-resolution.js";
import { convergenceManagedKnowledgePath } from "./managed-knowledge-scope.js";
import { convergenceOperationEffects } from "./effect-source-fence.js";
import {
  classifyConvergenceAssets,
  recordConvergenceAssetSettlement,
  toolGeneratedOpaqueSources,
} from "./asset-verification.js";
import {
  carriedParkedSources,
  mergeParkedSources,
  obligationParkedSources,
  parkedSourcesAttention,
  type ParkedConvergenceSource,
} from "./convergence-parking.js";
import {
  lifecyclePlanParked,
  lifecyclePlanRejection,
  parkedLifecycleCurrencyReasons,
  parkLifecyclePlan,
} from "./lifecycle-plan-parking.js";
import { commitSettledOutputsAtBoundary } from "./settled-output-boundary.js";
import { convergenceAssessmentSources } from "./assessment-scope.js";
import {
  canonicalJson,
  sha256,
  createKnowledgeMigrationPlan,
  applyKnowledgeMigrationPlan,
  createKnowledgeInstructionBridgePlan,
  applyKnowledgeInstructionBridgePlan,
  inspectConfiguredDocumentNormalization,
  inspectRepositoryKnowledgeCurrency,
  lintRepositoryKnowledge,
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStageResult,
} from "@lervo/repository-knowledge";
import { withConvergenceAssignment } from "./workforce.js";
import { reviewLifecyclePlan } from "./lifecycle-plan-review.js";
import { completeConvergenceStage, waitingConvergenceStage } from "./stage-receipt.js";
import { recordConvergenceMaterialization } from "./materialization-event.js";
import { verifyConvergenceEffect } from "./stage-verification.js";
import { pathWithinConvergenceRoots } from "./delegation.js";
import { commitKnowledgeEffect } from "./knowledge-effect-commit.js";
import { lifecycleEffectNotice } from "./lifecycle-effect-notice.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { resolveConvergenceAssetDispositions } from "./asset-disposition-manifest.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { convergenceSourceObservation } from "./source-observation.js";

export async function verifyConvergenceLifecycle(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  assertLease: () => void,
): Promise<KnowledgeConvergenceStageResult> {
  const root = context.storage.paths.repositoryRoot;
  await scanCompleteConfiguredRepositoryKnowledge(root);
  // A pre-ADR-0479 obligation retained a canonical rejection here; canonical isolation resumes it.
  if (state.stageData.canonicalRejection != null)
    return completeConvergenceStage({
      sources: convergenceSourceObservation(context),
      artifacts: context.storage.artifacts,
      state,
      stage: "lifecycle_verification",
      nextStage: "assessment",
      stageData: { canonicalRejection: null },
      proof: { status: "retained_rejection_isolated" },
    });
  const candidates = await resolveConvergenceCandidates(context, state, assertLease);
  if (candidates !== null) return candidates;
  // Publication and instruction bridges bind HEAD, so they are planned only after this commit.
  const committed = await commitSettledOutputsAtBoundary(context, state, "lifecycle_verification");
  if (committed !== null) return committed;
  const bridge = await createKnowledgeInstructionBridgePlan({
    repositoryRoot: root,
    provider: "claude",
  });
  const migration = await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" });
  // ADR-0485: a parked exact bridge plan yields to the remaining lifecycle work.
  const parkedPlans = mergeParkedSources(
    await carriedParkedSources(context.storage, state),
    obligationParkedSources(state),
  );
  const bridgePending =
    bridge.status !== "current" &&
    !lifecyclePlanParked(parkedPlans, "instruction_bridge", sha256(canonicalJson(bridge)));
  const plan = bridgePending
    ? bridge
    : migration.operations.some((operation) => operation.action !== "unchanged")
      ? migration
      : null;
  if (plan) {
    const bridgePlan = "profile" in plan;
    const paths = plan.operations
      .filter((operation) => operation.action !== "unchanged")
      .map((operation) => operation.path);
    let approval: Awaited<ReturnType<typeof reviewLifecyclePlan>> | null = null;
    try {
      approval =
        bridgePlan && plan.status === "review_required"
          ? await reviewLifecyclePlan(context, state, assertLease, plan, paths)
          : null;
    } catch (error) {
      const rejection = lifecyclePlanRejection(error);
      if (rejection === null || !bridgePlan) throw error;
      return completeConvergenceStage({
        sources: convergenceSourceObservation(context),
        artifacts: context.storage.artifacts,
        state,
        stage: "lifecycle_verification",
        nextStage: "lifecycle_verification",
        stageData: {
          parkedSources: parkLifecyclePlan(
            obligationParkedSources(state),
            "instruction_bridge",
            rejection,
          ),
        },
        proof: {
          status: "lifecycle_plan_parked",
          planKind: "instruction_bridge",
          planHash: rejection.planHash,
        },
      });
    }
    // ADR-0561: a reviewed bridge plan carries its own exact path set, whatever the roots.
    const reviewed = approval !== null;
    return withConvergenceAssignment({
      storage: context.storage,
      provider: context.provider,
      stage: "lifecycle_verification",
      role: "writer",
      state,
      paths,
      writeScope: reviewed ? "reviewed_plan" : "delegation_roots",
      assertLease,
      run: async (authority) => {
        if (
          (!reviewed &&
            paths.some(
              (path) =>
                !convergenceManagedKnowledgePath(path) &&
                !pathWithinConvergenceRoots(path, [
                  ...authority.delegation.canonicalRoots,
                  ...authority.delegation.normalizationRoots,
                ]),
            )) ||
          approval?.reviewerAgentId === authority.agent.agentId
        )
          throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
        await authority.assertCurrent();
        context.assertSourceExact(state);
        const record = async (receipt: unknown) => {
          await authority.assertCurrent();
          const validation = await lintRepositoryKnowledge(
            root,
            bridgePlan ? { allowTransactionPlanId: plan.planId } : {},
          );
          if (validation.coverage !== "complete" || !validation.valid)
            throw new KnowledgeConvergenceRuntimeError("knowledge_lint_invalid");
          const verification = await verifyConvergenceEffect(
            context,
            authority,
            state.baseline.policyHash,
          );
          await recordConvergenceMaterialization(context.storage, {
            operation: bridgePlan ? "instruction_bridge_update" : "migrate",
            planId: plan.planId,
            sourceSnapshotId: plan.sourceSnapshotId,
            policyHash: state.baseline.policyHash,
            receipt: { receipt, approval, verification },
            created: [],
            updated: paths,
            deleted: [],
            validation,
          });
        };
        const receipt = bridgePlan
          ? await applyKnowledgeInstructionBridgePlan({
              plan,
              now: new Date(),
              recordApplied: record,
              ...(plan.status === "review_required"
                ? { approvedOperationId: plan.operationId, approvedHash: plan.approvalHash }
                : {}),
            })
          : await applyKnowledgeMigrationPlan(plan, new Date(), record);
        context.sourceObservation?.noteChange();
        // ADR-0561: the reviewed bridge lands as its own commit, the undo point the notice names.
        await authority.assertCurrent();
        const commit =
          "profile" in plan && approval !== null
            ? await commitKnowledgeEffect({
                repositoryRoot: root,
                paths,
                notice: lifecycleEffectNotice(
                  plan,
                  `lifecycle reviewer ${approval.reviewerAgentId} approved`,
                ),
              })
            : null;
        return completeConvergenceStage({
          sources: convergenceSourceObservation(context),
          artifacts: context.storage.artifacts,
          state,
          stage: "lifecycle_verification",
          nextStage: "lifecycle_verification",
          stageData: {},
          approvedEffects: convergenceOperationEffects(plan.operations),
          ...(commit?.status === "committed"
            ? { committedHead: { before: commit.before, after: commit.after } }
            : {}),
          proof: {
            status: "ordered_lifecycle_applied",
            receipt,
            approval,
            commit: commit?.status === "committed" ? commit.after : null,
          },
        });
      },
    });
  }
  // The pair proves currency and lint read one stable snapshot; the asset settlement below fences.
  const sources = convergenceSourceObservation(context);
  const before = sources.current(state.baseline.policyHash);
  const currency = await inspectRepositoryKnowledgeCurrency(root);
  const lint = await lintRepositoryKnowledge(root);
  const after = sources.current(state.baseline.policyHash);
  const expectedSources = convergenceAssessmentSources(state);
  const offset = Number(state.stageData.canonicalOffset ?? 0);
  if (before.snapshotHash !== after.snapshotHash)
    throw new KnowledgeConvergenceRuntimeError("source_bytes_changed");
  const pendingNormalization = (
    await inspectConfiguredDocumentNormalization({ repositoryRoot: root })
  ).pendingDocuments;
  const parked = await currentParkedSources(
    context,
    state,
    expectedSources,
    pendingNormalization,
    currency.reasons,
  );
  const parkedCanonical = new Set(
    parked.filter((item) => item.stage === "canonical").map((item) => item.path),
  );
  const coveredSources = expectedSources.filter((source) => !parkedCanonical.has(source.path));
  const coverage =
    (state.stageData.canonicalCoverage as
      { path: string; contentHash: string; disposition: string }[] | undefined) ?? [];
  const completeCoverage =
    coverage.length === coveredSources.length &&
    new Set(coverage.map((item) => item.path)).size === coveredSources.length &&
    coveredSources.every((source) =>
      coverage.some(
        (item) =>
          item.path === source.path &&
          item.contentHash === source.contentHash &&
          ["no_change", "covered", "candidate"].includes(item.disposition),
      ),
    );
  // Pending normalization that consists only of parked documents is reported as parked.
  const parkedNormalization = new Set(
    parked.filter((item) => item.stage === "normalization").map((item) => item.path),
  );
  const parkedLifecycle = parkedLifecycleCurrencyReasons(parked);
  const parkedOnly =
    parked.length > 0 &&
    pendingNormalization.every((path) => parkedNormalization.has(path)) &&
    currency.reasons.every(
      (reason) =>
        (reason === "normalization_pending" && parkedNormalization.size > 0) ||
        parkedLifecycle.has(reason),
    );
  if (
    (!currency.current && !parkedOnly) ||
    lint.coverage !== "complete" ||
    !lint.valid ||
    offset !== expectedSources.length ||
    !completeCoverage
  )
    return waitingConvergenceStage({
      artifacts: context.storage.artifacts,
      state,
      kind: "attention_required",
      reason: "knowledge_lifecycle_incomplete",
      dependency: {
        kind: "lifecycle_currency",
        snapshotHash: state.snapshotHash,
        currency,
        lintHash: sha256(canonicalJson(lint)),
        coveredSources: offset,
        expectedSources: expectedSources.length,
      },
    });
  if (parked.length) return parkedSourcesAttention(context.storage.artifacts, state, parked);
  return withConvergenceAssignment({
    storage: context.storage,
    provider: context.provider,
    stage: "lifecycle_verification",
    role: "reviewer",
    state,
    paths: [...new Set(state.baseline.sources.map((source) => source.path.split("/")[0]!))],
    assertLease,
    run: async (authority) => {
      const assets = classifyConvergenceAssets(
        root,
        state,
        authority.delegation,
        await toolGeneratedOpaqueSources(root, state),
      );
      const verification = await verifyConvergenceEffect(
        context,
        authority,
        state.baseline.policyHash,
      );
      context.assertSourceExact(state);
      const assetSettlement = await recordConvergenceAssetSettlement(
        context.storage.artifacts,
        assets,
        verification,
      );
      return completeConvergenceStage({
        sources: convergenceSourceObservation(context),
        artifacts: context.storage.artifacts,
        state,
        stage: "lifecycle_verification",
        nextStage: null,
        stageData: {},
        knowledgeSnapshotHash: currency.snapshotHash,
        proof: {
          currency,
          lint,
          verification,
          scopeHash: sha256(canonicalJson(state.baseline.sources)),
          coveredSources: offset,
          canonicalCoverageHash: sha256(canonicalJson(coverage)),
          assetDispositionHash: sha256(
            canonicalJson(resolveConvergenceAssetDispositions(root, authority.delegation)),
          ),
          assetSettlement,
        },
      });
    },
  });
}

/**
 * Parked sources of this obligation and the latest earlier one, still bound to their exact bytes.
 * A parked normalization document counts only while it is still pending.
 */
async function currentParkedSources(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  expectedSources: readonly { path: string; contentHash: string }[],
  pendingNormalization: readonly string[],
  currencyReasons: readonly string[],
): Promise<ParkedConvergenceSource[]> {
  const hashes = new Map(state.baseline.sources.map((source) => [source.path, source.contentHash]));
  const assessed = new Set(expectedSources.map((source) => source.path));
  const pending = new Set(pendingNormalization);
  return mergeParkedSources(
    await carriedParkedSources(context.storage, state),
    obligationParkedSources(state),
  ).filter((item) =>
    // A parked plan stays parked only while its lifecycle work is still pending.
    item.stage === "lifecycle"
      ? [...parkedLifecycleCurrencyReasons([item])].some((reason) =>
          currencyReasons.includes(reason),
        )
      : hashes.get(item.path) === item.contentHash &&
        (item.stage === "canonical" ? assessed.has(item.path) : pending.has(item.path)),
  );
}
