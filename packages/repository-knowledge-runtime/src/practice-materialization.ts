import { lstat, mkdir, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import {
  applyDurableKnowledgeOperations,
  authorizeCurrentRepositoryDocumentLayout,
  canonicalJson,
  practiceReviewValid,
  sha256,
  type KnowledgeConvergenceInput,
} from "@lervo/repository-knowledge";
import { repositoryPathWithinScope } from "@lervo/work-controller";
import type { InstructionCaptureContext } from "./instruction-capture-assessment.js";
import type { PracticeCandidate, PracticeState } from "./practice-state.js";
import { practiceFunnel } from "./practice-state.js";
import { assertConvergenceDelegation, loadConvergenceDelegation } from "./delegation.js";
import { knowledgeOutputCommitGrant, CONVERGENCE_HOST_TRAILER } from "./convergence-owner-fence.js";
import { KNOWLEDGE_OUTPUT_COMMIT_AUTHOR } from "./knowledge-output-commit.js";
import { loadPracticeCatalog } from "./practice-catalog.js";
import { ordinaryConvergenceSourceBytes } from "./source-file.js";
import { withPracticeAssignment } from "./practice-assignment.js";
import { discoverConvergenceBaseline } from "./baseline.js";
import { assertConvergenceSource } from "./host.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { sealCanonicalDrafts } from "./canonical-workspace.js";
import { prepareCanonicalGitIntegration } from "./canonical-integration-candidate.js";
import { recordConvergenceMaterialization } from "./materialization-event.js";
import { writePracticeState } from "./practice-store.js";
import { requestPracticeWriteScope } from "./practice-scope.js";
import { commitKnowledgeOutputPaths } from "./freshness-commit.js";

export function practiceWriteAuthority(roots: string[]): boolean {
  return roots.some((r) => repositoryPathWithinScope(".agents/skills", r));
}

export async function createPracticeClaudeLink(
  root: string,
  name: string,
  roots: string[],
): Promise<boolean> {
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) ||
    !roots.some((r) => repositoryPathWithinScope(".claude/skills", r))
  )
    return false;
  let directory = root;
  for (const part of [".claude", "skills"]) {
    directory = resolve(directory, part);
    await mkdir(directory, { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "EEXIST") throw e;
    });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
  }
  try {
    await symlink(`../../.agents/skills/${name}`, resolve(directory, name));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

/** Exact review, current catalog and target preimage precede every delegated repository effect. */
export async function materializePractice(
  context: InstructionCaptureContext,
  state: PracticeState,
  candidate: PracticeCandidate,
): Promise<void> {
  const root = context.storage.paths.repositoryRoot;
  const loaded = await loadConvergenceDelegation(root);
  const delegation = await assertConvergenceDelegation({
    repositoryRoot: root,
    projectId: context.storage.manifest.projectId,
    expectedHash: loaded?.contentHash ?? null,
    provider: context.provider,
    now: context.now(),
  });
  if (!practiceWriteAuthority(delegation.normalizationRoots)) {
    candidate.reason = "publication_authority_missing";
    await requestPracticeWriteScope(context);
    throw new Error("publication_authority_missing");
  }
  const grant = await knowledgeOutputCommitGrant(root, context.now().getTime());
  if (!grant.allowed) return;
  if (
    !candidate.draft ||
    !candidate.draftHash ||
    !candidate.review ||
    !candidate.drafterAgentId ||
    !candidate.drafterSessionId
  )
    throw new Error("review_invalid");
  const catalog = await loadPracticeCatalog(root, delegation, state);
  if (
    !catalog.complete ||
    !practiceReviewValid({
      expected: {
        draftHash: sha256(candidate.draft),
        evidenceHashes: candidate.evidenceHashes,
        targetHash: candidate.targetHash,
        catalogDigest: catalog.digest,
      },
      review: candidate.review,
      drafterAgentId: candidate.drafterAgentId,
      drafterSessionId: candidate.drafterSessionId,
    })
  ) {
    candidate.state = "assessed";
    candidate.review = null;
    throw new Error("review_invalid");
  }
  const name = /^name: ([a-z0-9-]+)$/mu.exec(candidate.draft)?.[1];
  if (!name) throw new Error("review_invalid");
  const path = `.agents/skills/${name}/SKILL.md`;
  if (candidate.overlap === "partial_overlap" && !candidate.targetOwned) {
    candidate.reason = "user_owned_skill";
    return;
  }
  let current: string | null = null;
  try {
    current = sha256(ordinaryConvergenceSourceBytes(root, path, 8192));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("target_changed", { cause: error });
  }
  if (
    current !== candidate.targetHash ||
    (current !== null && !state.generated.some((s) => s.path === path && s.versionHash === current))
  ) {
    candidate.state = "assessed";
    throw new Error("target_changed");
  }
  const linkRoots = [...delegation.canonicalRoots, ...delegation.normalizationRoots];
  const linkPath = `.claude/skills/${name}`;
  const linkAbsent = await lstat(resolve(root, linkPath)).then(
    () => false,
    (e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
      return true;
    },
  );
  const links =
    linkAbsent && linkRoots.some((r) => repositoryPathWithinScope(".claude/skills", r))
      ? [{ path: linkPath, target: `../../.agents/skills/${name}` }]
      : [];
  const baseline = await discoverConvergenceBaseline(
    root,
    context.storage.events,
    context.storage.artifacts,
  );
  const input: KnowledgeConvergenceInput = {
    schemaVersion: 1,
    obligationId: candidate.candidateId,
    baseline,
    snapshotHash: baseline.sourceSnapshotHash,
    receipts: [],
    stageData: { practiceCandidateId: candidate.candidateId, draftHash: candidate.draftHash },
  };
  const runtime: ConvergenceRuntimeContext = {
    ...context,
    liveWorkPending: context.liveWorkPending,
    assertSource: (state) => assertConvergenceSource(runtime, state),
  };
  const drafts = [{ path, beforeHash: current, content: candidate.draft }];
  const paths = [path, ...links.map((l) => l.path)];
  const sealed = await withPracticeAssignment({
    context,
    role: "writer",
    key: `${candidate.candidateId}:${candidate.draftHash}`,
    paths,
    run: (authority) =>
      sealCanonicalDrafts(runtime, input, authority, drafts, {
        ...KNOWLEDGE_OUTPUT_COMMIT_AUTHOR,
        subject: "docs: learn reviewed portable practice",
        links,
        trailers: `Lervo-Practice-Candidate: ${candidate.candidateId}${grant.hostHash === null ? "" : `\n${CONVERGENCE_HOST_TRAILER}: ${grant.hostHash}`}`,
      }),
  });
  await withPracticeAssignment({
    context,
    role: "integrator",
    key: `${candidate.candidateId}:${candidate.draftHash}:integration`,
    paths,
    run: async (authority) => {
      if (!(await knowledgeOutputCommitGrant(root, context.now().getTime())).allowed)
        throw new Error("publication_authority_missing");
      const integrated = await prepareCanonicalGitIntegration(
        runtime,
        input,
        authority,
        sealed.workspaceId,
      );
      const operations = [
        {
          path,
          action: current === null ? ("create" as const) : ("update" as const),
          ownership: "lervo_generated" as const,
          mediaType: "text/markdown" as const,
          content: candidate.draft!,
          desiredHash: candidate.draftHash!,
          ...(current === null ? {} : { expectedCurrentHash: current }),
        },
      ];
      const planId = `kstruct_${sha256(canonicalJson([candidate.candidateId, operations])).slice(7, 31)}`;
      await applyDurableKnowledgeOperations({
        repositoryRoot: root,
        projectId: context.storage.manifest.projectId,
        planId,
        operations,
        documentLayoutPermit: await authorizeCurrentRepositoryDocumentLayout({
          repositoryRoot: root,
          operations,
        }),
        receipt: {
          candidateId: candidate.candidateId,
          draftHash: candidate.draftHash,
          integration: integrated.integration,
        },
        recordApplied: (receipt) =>
          recordConvergenceMaterialization(context.storage, {
            operation: "practice_skill",
            planId,
            sourceSnapshotId: baseline.sourceSnapshotId,
            policyHash: baseline.policyHash,
            receipt,
            created: current === null ? [path] : [],
            updated: current === null ? [] : [path],
            deleted: [],
            validation: { review: candidate.review },
          }),
      });
      if (links.length) await createPracticeClaudeLink(root, name, linkRoots);
      return { targetCommit: integrated.integration.targetAfterCommit };
    },
  }).then((result) => {
    candidate.commit = result.targetCommit;
  });
  candidate.state = "materialized";
  candidate.reason = null;
  const publicationCommit = await commitKnowledgeOutputPaths({
    repositoryRoot: root,
    paths,
    subject: "docs: learn reviewed portable practice",
    trailer: { key: "Lervo-Practice-Candidate", candidateId: candidate.candidateId },
  });
  if (publicationCommit !== null) candidate.commit = publicationCommit;
  state.generated = state.generated.filter((s) => s.path !== path);
  state.generated.push({
    name,
    path,
    versionHash: candidate.draftHash,
    candidateId: candidate.candidateId,
    commit: candidate.commit!,
    exposedAt: null,
    reevaluatedAt: null,
  });
  practiceFunnel(state, context.now(), "materialized");
  await writePracticeState(root, state, context.now());
}
