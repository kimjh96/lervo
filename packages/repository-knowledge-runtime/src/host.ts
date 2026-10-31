import { admittedBackgroundContext } from "./background-provider.js";
import {
  captureConvergenceSettlementAuthority,
  assertConvergenceSettlementAuthority,
} from "./settlement-fence.js";
import { assertCanonicalReviewContextCurrent } from "@lervo/repository-context";
import { listAssignments } from "@lervo/agent-workforce";
import {
  sha256,
  canonicalJson,
  assertNoKnowledgeMaterializationTransaction,
  type KnowledgeConvergenceHost,
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStageResult,
} from "@lervo/repository-knowledge";
import { cycleScopedConvergenceDiscovery } from "./baseline.js";
import { knowledgeProviderAdmissionState } from "./provider-admission.js";
import { captureConvergenceSources } from "./source-capture.js";
import { assertConvergenceDelegation, loadConvergenceDelegation } from "./delegation.js";
import { assessCanonicalBaseline } from "./canonical-assessment.js";
import { reviewCanonicalBaseline } from "./canonical-review.js";
import { integrateCanonicalBaseline } from "./canonical-integration-stage.js";
import { generateNormalizationBatch } from "./normalization-generation.js";
import { reviewNormalizationBatch } from "./normalization-review-stage.js";
import { applyNormalizationBatch } from "./normalization-apply-stage.js";
import { prepareConvergenceLifecycle } from "./lifecycle-prefix.js";
import { verifyConvergenceLifecycle } from "./lifecycle-final.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { resolveIntegrationTarget } from "./integration-target-sync.js";
import { inspectIntegrationTargetAbsorption } from "./integration-target-absorption.js";
import { regenerateStaleReview, staleReviewContext } from "./review-context-regeneration.js";
import { inspectRetainedCanonicalIntegration } from "./canonical-integration-recovery.js";
import type { CanonicalBatch } from "./canonical-review.js";
import { materializationTransactionState } from "./materialization-transaction.js";
import {
  convergenceEvaluationContract,
  settledUnderEarlierContract,
} from "./evaluation-contract.js";
import {
  commitSettledOutputsAtBoundary,
  settledOutputBoundary,
} from "./settled-output-boundary.js";

export function assertConvergenceSource(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
): void {
  if (context.signal.aborted) throw new KnowledgeConvergenceRuntimeError("knowledge_cancelled");
  const observed = captureConvergenceSources(
    context.storage.paths.repositoryRoot,
    state.baseline.policyHash,
  );
  if (observed.snapshotHash !== state.snapshotHash)
    throw new KnowledgeConvergenceRuntimeError("source_bytes_changed");
  const bindings = [
    ...((
      state.stageData.candidateReview as
        { context?: { path: string; contentHash: string }[] } | undefined
    )?.context ?? []),
    ...((
      state.stageData.normalizationReview as
        { context?: { path: string; contentHash: string }[] } | undefined
    )?.context ?? []),
    ...((
      state.stageData.canonicalBatch as
        { context?: { path: string; contentHash: string }[] } | undefined
    )?.context ?? []),
  ];
  assertCanonicalReviewContextCurrent(context.storage.paths.repositoryRoot, bindings);
}

const UNCERTAIN_EFFECT_CODES: ReadonlySet<string> = new Set([
  "knowledge_effect_uncertain",
  "host_effect_uncertain",
  "knowledge_recovery_required",
  "knowledge_recovery_busy",
  "knowledge_recovery_invalid",
  "knowledge_rollback_failed",
]);

export function createConvergenceRuntimeHost(
  context: ConvergenceRuntimeContext,
): KnowledgeConvergenceHost {
  const root = context.storage.paths.repositoryRoot;
  const source = (state: KnowledgeConvergenceInput) => assertConvergenceSource(context, state);
  const discover = cycleScopedConvergenceDiscovery(
    root,
    context.storage.events,
    context.storage.artifacts,
  );
  return {
    discover,
    evaluationContract: convergenceEvaluationContract(),
    assertSettlement: (state) => {
      source(state);
      assertConvergenceSettlementAuthority(context, state);
    },
    assertCurrent: async (state) => {
      source(state);
      if (state.baseline.delegationHash !== null && state.receipts.length > 0)
        await assertConvergenceDelegation({
          repositoryRoot: root,
          projectId: state.baseline.projectId,
          expectedHash: state.baseline.delegationHash,
          provider: context.provider,
        });
      await captureConvergenceSettlementAuthority(context, state);
      source(state);
    },
    // ADR-0490: the owner's pre-stage currency check would reject a stale review context before
    // `runStage` could regenerate it, so a stale review is regenerated here first.
    prepareStage: async (stage, state) => {
      try {
        source(state);
        return null;
      } catch (error) {
        return staleReviewContext(error) ? regenerateStaleReview(context, state, stage) : null;
      }
    },
    dependencyCurrent: async (hash) => {
      const bytes = await context.storage.artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`);
      if (sha256(bytes) !== hash)
        throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_invalid");
      const dependency = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes)) as {
        code?: string;
        snapshotHash?: string;
        delegationHash?: string | null;
        kind?: string;
        targetRef?: string;
        targetCommit?: string;
        evidenceHash?: string;
        reevaluateAt?: string;
        evaluationContract?: string;
      };
      const baseline = await discover();
      if (
        dependency.snapshotHash !== undefined &&
        dependency.snapshotHash !== baseline.sourceSnapshotHash
      )
        return false;
      if (
        dependency.delegationHash !== undefined &&
        dependency.delegationHash !== baseline.delegationHash
      )
        return false;
      // ADR-0485: a stall settled by earlier evaluation logic is reevaluated once by this logic.
      // Uncertain effects keep their own inspection; requeueing them could repeat a write.
      if (
        settledUnderEarlierContract(dependency) &&
        !UNCERTAIN_EFFECT_CODES.has(dependency.code ?? "")
      )
        return false;
      if (dependency.kind === "canonical_target_preimage") {
        const authority = await loadConvergenceDelegation(root);
        if (!authority || authority.delegation.integrationTarget.ref !== dependency.targetRef)
          return false;
        const target = await resolveIntegrationTarget(
          root,
          authority.delegation.integrationTarget.ref,
        );
        if (target !== dependency.targetCommit) return false;
        // ADR-0482: a squash merge that absorbed the ref lets integration preflight move it.
        const head = await resolveIntegrationTarget(root, "HEAD");
        return (
          head === null ||
          (await inspectIntegrationTargetAbsorption(root, target, head).catch(() => null)) === null
        );
      }
      // The attention clears once the delegated ref exists, whoever created it.
      if (dependency.code === "knowledge_integration_target_unavailable") {
        const authority = await loadConvergenceDelegation(root);
        return (
          authority !== null &&
          (await resolveIntegrationTarget(root, authority.delegation.integrationTarget.ref)) ===
            null
        );
      }
      if (dependency.code === "knowledge_authority_unavailable") {
        const authority = await loadConvergenceDelegation(root);
        return (
          authority === null ||
          authority.delegation.state !== "active" ||
          Date.parse(authority.delegation.expiresAt) <= Date.now()
        );
      }
      if (dependency.code === "provider_not_admitted") {
        try {
          await admittedBackgroundContext(context);
          return false;
        } catch (error) {
          if (
            ["provider_not_admitted", "knowledge_capacity_unavailable"].includes(
              (error as { code: string }).code,
            )
          )
            return true;
          throw error;
        }
      }
      if (dependency.code === "knowledge_cancelled") return context.signal.aborted;
      if (
        ["knowledge_effect_uncertain", "host_effect_uncertain"].includes(dependency.code ?? "") &&
        dependency.evidenceHash
      ) {
        const proofBytes = await context.storage.artifacts.get(
          `lervo-cas://sha256/${dependency.evidenceHash.slice(7)}`,
        );
        if (sha256(proofBytes) !== dependency.evidenceHash)
          throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
        const proof = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(proofBytes)) as {
          kind?: string;
          input?: KnowledgeConvergenceInput;
        };
        const batch = proof.input?.stageData.canonicalBatch as CanonicalBatch | undefined;
        if (
          proof.kind === "convergence_assignment_failure" &&
          proof.input &&
          batch?.assessment.drafts.length &&
          (await inspectRetainedCanonicalIntegration(context, proof.input, batch.assessment.drafts))
        )
          return false;
      }
      if (
        dependency.code === "knowledge_provider_paused" ||
        dependency.code === "knowledge_capacity_unavailable"
      ) {
        const admission = await knowledgeProviderAdmissionState({
          provider: context.provider,
          ...(context.admissionDirectory === undefined
            ? {}
            : { directory: context.admissionDirectory }),
        });
        return admission.paused || admission.activeCalls >= 2 || (await context.liveWorkPending());
      }
      if (
        [
          "knowledge_recovery_required",
          "knowledge_recovery_busy",
          "knowledge_recovery_invalid",
        ].includes(dependency.code ?? "")
      ) {
        try {
          await assertNoKnowledgeMaterializationTransaction({ repositoryRoot: root });
          return false;
        } catch {
          return true;
        }
      }
      // An untyped host failure may have been external; it holds only until its reevaluation time.
      if (dependency.code === "knowledge_stage_failure_unclassified")
        return Date.parse(dependency.reevaluateAt ?? "") > Date.now();
      // Semantic refusals and unknown provider resets remain content-bound until explicit reviewed change.
      if (dependency.code === "assignment_path_conflict")
        return (await listAssignments(root)).some(
          (assignment) =>
            assignment.status === "leased" &&
            assignment.accessMode !== "read_only" &&
            Date.parse(assignment.lease?.expiresAt ?? "") > Date.now(),
        );
      return true;
    },
    runStage: async (stage, state, assertLease): Promise<KnowledgeConvergenceStageResult> => {
      const stageContext = [
        "assessment",
        "canonical_review",
        "normalization_generation",
        "normalization_review",
      ].includes(stage)
        ? await admittedBackgroundContext(context)
        : context;
      await assertConvergenceDelegation({
        repositoryRoot: root,
        projectId: state.baseline.projectId,
        expectedHash: state.baseline.delegationHash,
        provider: stageContext.provider,
      });
      assertLease();
      try {
        source(state);
      } catch (error) {
        const regenerated = staleReviewContext(error)
          ? await regenerateStaleReview(context, state, stage)
          : null;
        if (regenerated === null) throw error;
        return regenerated;
      }
      const transaction = await materializationTransactionState(root);
      // A live owner settles on its own, so the stage retries instead of recording recovery.
      if (transaction === "busy")
        throw new KnowledgeConvergenceRuntimeError("knowledge_materialization_busy");
      if (transaction === "recovery_required")
        throw new KnowledgeConvergenceRuntimeError("knowledge_recovery_required");
      try {
        if (settledOutputBoundary(stage)) {
          const committed = await commitSettledOutputsAtBoundary(context, state, stage);
          if (committed !== null) return committed;
        }
        switch (stage) {
          case "assessment":
            return (
              (await prepareConvergenceLifecycle(stageContext, state, assertLease)) ??
              (await assessCanonicalBaseline(stageContext, state, assertLease))
            );
          case "canonical_review":
            return await reviewCanonicalBaseline(stageContext, state, assertLease);
          case "canonical_integration":
            return await integrateCanonicalBaseline(stageContext, state, assertLease);
          case "normalization_generation":
            return await generateNormalizationBatch(stageContext, state, assertLease);
          case "normalization_review":
            return await reviewNormalizationBatch(stageContext, state, assertLease);
          case "normalization_apply":
            return await applyNormalizationBatch(stageContext, state, assertLease);
          case "lifecycle_verification":
            return await verifyConvergenceLifecycle(stageContext, state, assertLease);
        }
      } catch (error) {
        const failure = error instanceof Error ? error : new Error("Unknown convergence failure.");
        if (!(failure as { dependencyHash?: string }).dependencyHash) {
          const proof = await context.storage.artifacts.put(
            canonicalJson({
              schemaVersion: 1,
              kind: "private_stage_failure",
              obligationId: state.obligationId,
              stage,
              snapshotHash: state.snapshotHash,
              code: (failure as { code?: string }).code ?? null,
              name: failure.name,
              message: failure.message.slice(0, 8192),
              stack: failure.stack?.slice(0, 16384) ?? null,
            }),
          );
          Object.assign(failure, { dependencyHash: proof.contentHash });
        }
        throw failure;
      }
    },
  };
}
