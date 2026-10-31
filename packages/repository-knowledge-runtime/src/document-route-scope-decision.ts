import type { ProjectStorage } from "@lervo/project-storage";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import { assertConvergenceDelegation, loadConvergenceDelegation } from "./delegation.js";
import {
  applyConvergenceDelegationPlan,
  type ConvergenceDelegationPlan,
} from "./delegation-plan.js";
import {
  proposeDocumentRouteScope,
  type DocumentRouteScopeProposal,
} from "./document-route-scope-proposal.js";
import { convergenceDelegationScope } from "./delegation-scope.js";
import {
  readConvergenceContinuityState,
  writeConvergenceContinuityState,
} from "./continuity-state.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { writeDocumentRouteScopeResponse } from "./document-route-scope-response.js";

/** A response binds the current proposal, its complete evidence, and the owner's exact turn. */
export async function recordDocumentRouteScopeDecision(input: {
  storage: ProjectStorage;
  proposalId: string;
  response: "accept" | "decline";
  evidenceArtifactHash: string;
  delegationPlan?: ConvergenceDelegationPlan;
}): Promise<DocumentRouteScopeProposal> {
  const { storage } = input;
  if (
    (storage.writableEventSchemaVersion ?? 1) < 4 ||
    !/^sha256:[a-f0-9]{64}$/u.test(input.evidenceArtifactHash)
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  const evidence = await storage.artifacts.get(
    `lervo-cas://sha256/${input.evidenceArtifactHash.slice(7)}`,
  );
  if (sha256(evidence) !== input.evidenceArtifactHash)
    throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
  const loaded = await loadConvergenceDelegation(storage.paths.repositoryRoot);
  if (loaded === null)
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  const delegation = await assertConvergenceDelegation({
    repositoryRoot: storage.paths.repositoryRoot,
    projectId: storage.manifest.projectId,
    expectedHash: loaded.contentHash,
    provider: loaded.delegation.providers[0]!,
  });
  const proposal = await proposeDocumentRouteScope({
    repositoryRoot: storage.paths.repositoryRoot,
    delegation,
  });
  if (proposal === null || proposal.proposalId !== input.proposalId)
    throw new KnowledgeConvergenceRuntimeError("knowledge_plan_stale");
  if (input.response === "accept") {
    const plan = input.delegationPlan;
    const expected = [
      ...new Set([...delegation.normalizationRoots, ...proposal.requiredPaths]),
    ].sort();
    if (
      proposal.acceptanceBlocker !== null ||
      plan === undefined ||
      canonicalJson([...plan.delegation.normalizationRoots].sort()) !== canonicalJson(expected) ||
      canonicalJson({
        ...convergenceDelegationScope(plan.delegation),
        normalizationRoots: expected,
      }) !==
        canonicalJson({ ...convergenceDelegationScope(delegation), normalizationRoots: expected })
    )
      throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
    await applyConvergenceDelegationPlan(storage, plan);
  } else if (input.delegationPlan !== undefined) {
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  }
  await writeDocumentRouteScopeResponse(storage, {
    proposal,
    response: input.response,
    evidenceArtifactHash: input.evidenceArtifactHash,
    policyHash: delegation.review.planHash,
  });
  const state = await readConvergenceContinuityState(storage.paths.repositoryRoot);
  if (state?.scopeChange?.proposalId === proposal.proposalId)
    await writeConvergenceContinuityState(storage.paths.repositoryRoot, {
      ...state,
      scopeResponse: input.response,
      findings: state.findings.filter((finding) => finding.code !== "delegation_scope_change"),
    });
  return proposal;
}
