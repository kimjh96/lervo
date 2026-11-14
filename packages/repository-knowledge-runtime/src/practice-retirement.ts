import {
  applyDurableKnowledgeOperations,
  authorizeCurrentRepositoryDocumentLayout,
  sha256,
  type KnowledgeConvergenceInput,
} from "@lervo/repository-knowledge";
import type { InstructionCaptureContext } from "./instruction-capture-assessment.js";
import type { GeneratedPracticeSkill, PracticeState } from "./practice-state.js";
import type { PracticeVersionUsage } from "./practice-usage-projection.js";
import { loadConvergenceDelegation, assertConvergenceDelegation } from "./delegation.js";
import { knowledgeOutputCommitGrant } from "./convergence-owner-fence.js";
import { ordinaryConvergenceSourceBytes } from "./source-file.js";
import { practiceWriteAuthority } from "./practice-materialization.js";
import { discoverConvergenceBaseline } from "./baseline.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { assertConvergenceSourceCurrent, assertConvergenceSourceExact } from "./host.js";
import { sealCanonicalDrafts } from "./canonical-workspace.js";
import { withPracticeAssignment } from "./practice-assignment.js";
import { prepareCanonicalGitIntegration } from "./canonical-integration-candidate.js";
import { KNOWLEDGE_OUTPUT_COMMIT_AUTHOR } from "./knowledge-output-commit.js";
import { appendPracticeEvent } from "./practice-events.js";
import { recordConvergenceMaterialization } from "./materialization-event.js";
import { commitKnowledgeOutputPaths } from "./freshness-commit.js";

/** A review may propose retirement. Only the verified integration removal records retired. */
export async function retirePracticeSkill(
  context: InstructionCaptureContext,
  state: PracticeState,
  skill: GeneratedPracticeSkill,
  usage: PracticeVersionUsage,
): Promise<void> {
  if (
    !usage.reevaluate ||
    usage.usageState !== "unused_with_coverage" ||
    usage.coverage !== "complete"
  )
    throw new Error("usage_coverage_unknown");
  const root = context.storage.paths.repositoryRoot;
  const loaded = await loadConvergenceDelegation(root);
  const delegation = await assertConvergenceDelegation({
    repositoryRoot: root,
    projectId: context.storage.manifest.projectId,
    expectedHash: loaded?.contentHash ?? null,
    provider: context.provider,
    now: context.now(),
  });
  if (!practiceWriteAuthority(delegation.normalizationRoots))
    throw new Error("publication_authority_missing");
  if (!(await knowledgeOutputCommitGrant(root, context.now().getTime())).allowed) return;
  if (sha256(ordinaryConvergenceSourceBytes(root, skill.path, 8192)) !== skill.versionHash)
    throw new Error("target_changed");
  const baseline = await discoverConvergenceBaseline(
    root,
    context.storage.events,
    context.storage.artifacts,
  );
  const input: KnowledgeConvergenceInput = {
    schemaVersion: 1,
    obligationId: skill.candidateId,
    baseline,
    snapshotHash: baseline.sourceSnapshotHash,
    receipts: [],
    stageData: { retirementVersion: skill.versionHash },
  };
  const runtime: ConvergenceRuntimeContext = {
    ...context,
    assertSourceExact: (state) => assertConvergenceSourceExact(runtime, state),
    assertSourceCurrent: (state) => assertConvergenceSourceCurrent(runtime, state),
  };
  const sealed = await withPracticeAssignment({
    context,
    role: "writer",
    key: `${skill.candidateId}:retire`,
    paths: [skill.path],
    run: (authority) =>
      sealCanonicalDrafts(runtime, input, authority, [], {
        ...KNOWLEDGE_OUTPUT_COMMIT_AUTHOR,
        subject: "docs: retire reviewed unused practice",
        trailers: `Lervo-Practice-Retirement: ${skill.candidateId}`,
        deletions: [{ path: skill.path, expectedHash: skill.versionHash }],
      }),
  });
  const commit = await withPracticeAssignment({
    context,
    role: "integrator",
    key: `${skill.candidateId}:retire-integration`,
    paths: [skill.path],
    run: async (authority) => {
      const result = await prepareCanonicalGitIntegration(
        runtime,
        input,
        authority,
        sealed.workspaceId,
      );
      const operations = [
        { action: "delete" as const, path: skill.path, expectedCurrentHash: skill.versionHash },
      ];
      const planId = `kstruct_${sha256(`${skill.candidateId}:retire:${skill.versionHash}`).slice(7, 31)}`;
      await applyDurableKnowledgeOperations({
        repositoryRoot: root,
        projectId: context.storage.manifest.projectId,
        planId,
        operations,
        documentLayoutPermit: await authorizeCurrentRepositoryDocumentLayout({
          repositoryRoot: root,
          operations,
        }),
        receipt: { candidateId: skill.candidateId, integration: result.integration },
        recordApplied: (receipt) =>
          recordConvergenceMaterialization(context.storage, {
            operation: "practice_retirement",
            planId,
            sourceSnapshotId: baseline.sourceSnapshotId,
            policyHash: baseline.policyHash,
            receipt,
            created: [],
            updated: [],
            deleted: [skill.path],
            validation: { usage },
          }),
      });
      return result.integration.targetAfterCommit;
    },
  });
  const candidate = state.candidates.find((c) => c.candidateId === skill.candidateId);
  await commitKnowledgeOutputPaths({
    repositoryRoot: root,
    paths: [skill.path],
    subject: "docs: retire reviewed unused practice",
    trailer: { key: "Lervo-Practice-Retirement", candidateId: skill.candidateId },
  });
  if (candidate) {
    candidate.state = "retired";
    candidate.commit = commit;
  }
  state.generated = state.generated.filter((s) => s !== skill);
  appendPracticeEvent(context.storage, "knowledge.skill.retired", {
    skillName: skill.name,
    versionHash: skill.versionHash,
    retirementCommit: commit,
    occurredAt: context.now().toISOString(),
  });
}
