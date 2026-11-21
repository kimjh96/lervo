import {
  canonicalJson,
  practiceReviewValid,
  renderPracticeSkill,
  sha256,
} from "@lervo/repository-knowledge";
import type { InstructionCaptureContext } from "./instruction-capture-assessment.js";
import type { PracticeCandidate, PracticeState } from "./practice-state.js";
import { practiceFunnel, practiceShapeSupport } from "./practice-state.js";
import { loadConvergenceDelegation } from "./delegation.js";
import { disclosePracticeCatalog, loadPracticeCatalog } from "./practice-catalog.js";
import { withPracticeProviderAssignment } from "./practice-provider-assignment.js";
import { appendPracticeEvent } from "./practice-events.js";
import { writePracticeState } from "./practice-store.js";
import { resolve } from "node:path";
import { loadRepositoryKnowledgeOutputFormatter } from "./knowledge-output-formatter.js";
import { assertPracticeEvidenceDisclosure } from "./practice-evidence-disclosure.js";
import {
  practiceCatalogView,
  practiceDraftContract,
  practiceReviewContract,
} from "./practice-review-contract.js";

export async function draftOrReviewPractice(
  context: InstructionCaptureContext,
  state: PracticeState,
  candidate: PracticeCandidate,
): Promise<void> {
  const root = context.storage.paths.repositoryRoot;
  const loaded = await loadConvergenceDelegation(root);
  if (!loaded) throw new Error("provider_not_admitted");
  const catalog = await loadPracticeCatalog(root, loaded.delegation, state);
  if (!catalog.complete) throw new Error("source_incomplete");
  const evidence = state.evidence.filter((e) => candidate.evidenceHashes.includes(e.evidenceHash));
  const shapeObservationCount = practiceShapeSupport(state, candidate.workDigests);
  if (
    !evidence.length ||
    evidence.length !== candidate.evidenceHashes.length ||
    evidence.some(
      (e) =>
        sha256(
          canonicalJson(
            Object.fromEntries(Object.entries(e).filter(([key]) => key !== "evidenceHash")),
          ),
        ) !== e.evidenceHash,
    )
  )
    throw new Error("source_incomplete");
  const assertDisclosure = async () => {
    const current = await loadConvergenceDelegation(root);
    if (!current) throw new Error("provider_not_admitted");
    const currentCatalog = await loadPracticeCatalog(root, current.delegation, state);
    if (!currentCatalog.complete || currentCatalog.digest !== catalog.digest)
      throw new Error("review_invalid");
    assertPracticeEvidenceDisclosure(evidence, currentCatalog);
  };
  await assertDisclosure();
  if (candidate.catalogDigest !== catalog.digest && candidate.state !== "assessed") {
    candidate.state = "assessed";
    candidate.review = null;
    candidate.reason = "review_invalid";
  }
  if (candidate.state === "unresolved") return;
  if (candidate.state === "assessed") {
    if (candidate.reason === "conflict" && candidate.catalogDigest === catalog.digest) return;
    // ADR-0604: the drafter names a target by reference and path; the contract maps it back.
    const contract = practiceDraftContract({
      catalog: disclosePracticeCatalog(catalog),
      evidencePaths: evidence.flatMap((e) => e.procedure.sourcePaths),
    });
    const drafted = await withPracticeProviderAssignment({
      context,
      role: "generator",
      assignmentKey: `${candidate.candidateId}:${catalog.digest}:${sha256(canonicalJson(candidate.evidenceHashes))}:${candidate.redrafts}`,
      paths: evidence.flatMap((e) => e.procedure.sourcePaths),

      kind: "draft",
      beforeCall: assertDisclosure,
      key: candidate.candidateId,
      data: { evidence, shapeObservationCount, catalog: contract.view },
      schema: contract.schema,
      prompt:
        "Use shapeObservationCount as a ranking and confidence signal, never proof or a prerequisite. Compare this practice semantically with every installed skill and applied rule. Choose already_covered (no change), partial_overlap (a delta to the named skill), conflict (hold both sources), or new. Name a target skill only by its catalog target reference and path, and null for both otherwise; partial_overlap needs one and new allows none. Draft one complete procedure only for new or partial_overlap, and null otherwise. Merge equivalent practices regardless of their names. Distinguish verified parts from assumptions. Cite only supplied repository paths. Do not invent capabilities.",
      resolve: (result, authority) => ({
        value: contract.parse(result),
        agentId: authority.agent.agentId,
        sessionId: authority.assignment.lease!.sessionId,
      }),
    });
    const answer = drafted.value;
    candidate.catalogDigest = catalog.digest;
    if (answer.overlap === "already_covered") {
      candidate.state = "reviewed_rejected";
      candidate.reason = "duplicate";
      practiceFunnel(state, context.now(), "drafted", "already_covered");
      return;
    }
    const target = answer.target;
    candidate.overlap = answer.overlap;
    candidate.targetSkill = target?.name ?? null;
    candidate.targetHash = target?.contentHash ?? null;
    candidate.targetOwned = target?.owned ?? false;
    if (answer.overlap === "conflict") {
      candidate.state = "unresolved";
      candidate.reason = "conflict";
      practiceFunnel(state, context.now(), "drafted", "conflict");
      return;
    }
    const procedure = answer.practice;
    if (!target && catalog.skills.some((s) => s.name === procedure.name))
      throw new Error("target_changed");
    candidate.draft = renderPracticeSkill(procedure);
    const formatter = await loadRepositoryKnowledgeOutputFormatter(root);
    candidate.draft =
      (await formatter?.format(
        resolve(root, `.agents/skills/${procedure.name}/SKILL.md`),
        candidate.draft,
        resolve(root, ".prettierignore"),
      )) ?? candidate.draft;
    if (Buffer.byteLength(candidate.draft) > 8192)
      throw new TypeError("Skill draft exceeds 8 KiB.");
    candidate.draftHash = sha256(candidate.draft);
    candidate.drafterAgentId = drafted.agentId;
    candidate.drafterSessionId = drafted.sessionId;
    candidate.state = "drafted";
    candidate.reason = null;
    practiceFunnel(state, context.now(), "drafted");
    appendPracticeEvent(context.storage, "knowledge.skill_candidate.proposed", {
      candidateId: candidate.candidateId,
      practiceDigest: candidate.practiceDigest,
      workDigests: candidate.workDigests,
      overlap: candidate.overlap,
      targetSkill: candidate.targetSkill,
      draftHash: candidate.draftHash,
      occurredAt: context.now().toISOString(),
    });
    await writePracticeState(root, state, context.now());
    return;
  }
  if (
    candidate.state !== "drafted" ||
    !candidate.draftHash ||
    !candidate.draft ||
    !candidate.drafterAgentId ||
    !candidate.drafterSessionId
  )
    return;
  const binding = {
    draftHash: candidate.draftHash,
    evidenceHashes: candidate.evidenceHashes,
    targetHash: candidate.targetHash,
    catalogDigest: catalog.digest,
  };
  const contract = practiceReviewContract(binding);
  const review = await withPracticeProviderAssignment({
    context,
    role: "reviewer",
    assignmentKey: `${candidate.candidateId}:${candidate.draftHash}:${sha256(canonicalJson(binding))}`,
    paths: evidence.flatMap((e) => e.procedure.sourcePaths),
    assertAuthority: (authority) => {
      if (
        authority.agent.agentId === candidate.drafterAgentId ||
        authority.assignment.lease!.sessionId === candidate.drafterSessionId
      )
        throw new Error("review_invalid");
    },
    kind: "review",
    beforeCall: assertDisclosure,
    key: candidate.candidateId,
    data: {
      draft: candidate.draft,
      evidence,
      catalog: practiceCatalogView(disclosePracticeCatalog(catalog)),
      shapeObservationCount,
    },
    // ADR-0604: the reviewer answers a verdict only; Lervo attaches the exact binding at parse.
    schema: contract.schema,
    prompt:
      "Use shapeObservationCount as a confidence signal, never proof or a prerequisite. Independently review the exact skill draft against the retained sanitized evidence bundle and catalog. Check invocation and exclusion conditions, practical knowledge beyond existing rules and skills, inputs, preconditions, confirmation, stop conditions, verified steps versus assumptions, grounding, secrets, host-specific values and absence of capabilities. Accept exactly with accepted, or reject with not_reusable, duplicate, incomplete, or ungrounded. Do not defer review to the owner.",
    resolve: (value, authority) => {
      const review = contract.parse(value, {
        agentId: authority.agent.agentId,
        sessionId: authority.assignment.lease!.sessionId,
      });
      // Independence of the reviewer from the drafter, checked again on the bound review.
      if (
        !practiceReviewValid({
          expected: binding,
          review,
          drafterAgentId: candidate.drafterAgentId!,
          drafterSessionId: candidate.drafterSessionId!,
        })
      )
        throw new Error("review_invalid");
      return review;
    },
  });
  candidate.review = review;
  candidate.state = review.decision === "accept" ? "reviewed_accepted" : "reviewed_rejected";
  candidate.reason = review.reasonCode;
  practiceFunnel(
    state,
    context.now(),
    review.decision === "accept" ? "accepted" : "reviewed",
    review.decision === "reject" ? review.reasonCode : undefined,
  );
  appendPracticeEvent(context.storage, "knowledge.skill_candidate.resolved", {
    candidateId: candidate.candidateId,
    decision: review.decision,
    reasonCode: review.reasonCode,
    reviewerAgentId: review.reviewerAgentId,
    reviewedDraftHash: review.draftHash,
    catalogDigest: review.catalogDigest,
    occurredAt: context.now().toISOString(),
  });
}
