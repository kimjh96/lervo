import {
  canonicalJson,
  parseReusablePractice,
  practiceReviewValid,
  renderPracticeSkill,
  reusablePracticeSchema,
  sha256,
  type PracticeReview,
} from "@lervo/repository-knowledge";
import type { InstructionCaptureContext } from "./instruction-capture-assessment.js";
import type { PracticeCandidate, PracticeState } from "./practice-state.js";
import { practiceFunnel, practiceShapeSupport } from "./practice-state.js";
import { loadConvergenceDelegation } from "./delegation.js";
import { disclosePracticeCatalog, loadPracticeCatalog } from "./practice-catalog.js";
import { withPracticeAssignment } from "./practice-assignment.js";
import { callPracticeProvider } from "./practice-provider.js";
import { appendPracticeEvent } from "./practice-events.js";
import { writePracticeState } from "./practice-store.js";
import { resolve } from "node:path";
import { loadRepositoryKnowledgeOutputFormatter } from "./knowledge-output-formatter.js";

const draftSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    overlap: { enum: ["already_covered", "partial_overlap", "conflict", "new"] },
    targetSkill: { type: ["string", "null"] },
    practice: { anyOf: [{ type: "null" }, reusablePracticeSchema] },
  },
  required: ["overlap", "targetSkill", "practice"],
} as const;
const reviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    draftHash: { type: "string" },
    evidenceHashes: { type: "array", items: { type: "string" } },
    targetHash: { type: ["string", "null"] },
    catalogDigest: { type: "string" },
    decision: { enum: ["accept", "reject"] },
    reasonCode: { enum: ["accepted", "not_reusable", "duplicate", "incomplete", "ungrounded"] },
  },
  required: [
    "draftHash",
    "evidenceHashes",
    "targetHash",
    "catalogDigest",
    "decision",
    "reasonCode",
  ],
} as const;

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
  if (candidate.catalogDigest !== catalog.digest && candidate.state !== "assessed") {
    candidate.state = "assessed";
    candidate.review = null;
    candidate.reason = "review_invalid";
  }
  if (candidate.state === "unresolved") return;
  if (candidate.state === "assessed") {
    if (candidate.reason === "conflict" && candidate.catalogDigest === catalog.digest) return;
    const drafted = await withPracticeAssignment({
      context,
      role: "generator",
      key: `${candidate.candidateId}:${catalog.digest}:${sha256(canonicalJson(candidate.evidenceHashes))}:${candidate.redrafts}`,
      paths: evidence.flatMap((e) => e.procedure.sourcePaths),
      run: async (authority) => {
        const result = await callPracticeProvider({
          context,
          authority,
          kind: "draft",
          key: candidate.candidateId,
          data: {
            evidence,
            shapeObservationCount,
            catalog: disclosePracticeCatalog(catalog),
            waitingCandidates: state.candidates
              .filter((c) => c.candidateId !== candidate.candidateId)
              .slice(0, 8)
              .map((c) => ({ candidateId: c.candidateId, draft: c.draft?.slice(0, 1024) ?? null })),
          },
          schema: draftSchema,
          prompt:
            "Use shapeObservationCount as a ranking and confidence signal, never proof or a prerequisite. Compare this practice semantically with every installed skill and applied rule. Choose already_covered (no change), partial_overlap (a delta to the named skill), conflict (hold both sources), or new. Name a target only from the catalog. Draft one complete procedure only for new or partial_overlap. Merge equivalent practices regardless of their names. Distinguish verified parts from assumptions. Cite only supplied repository paths. Do not invent capabilities.",
        });
        const value = result as { overlap?: unknown; targetSkill?: unknown; practice?: unknown };
        if (
          !["already_covered", "partial_overlap", "conflict", "new"].includes(
            String(value?.overlap),
          )
        )
          throw new TypeError("Invalid practice overlap.");
        return {
          value,
          agentId: authority.agent.agentId,
          sessionId: authority.assignment.lease!.sessionId,
        };
      },
    });
    const value = drafted.value;
    candidate.catalogDigest = catalog.digest;
    if (value.overlap === "already_covered") {
      candidate.state = "reviewed_rejected";
      candidate.reason = "duplicate";
      practiceFunnel(state, context.now(), "drafted", "already_covered");
      return;
    }
    const target =
      typeof value.targetSkill === "string"
        ? catalog.skills.find((s) => s.name === value.targetSkill)
        : undefined;
    if (value.overlap === "partial_overlap" && !target)
      throw new TypeError("Invalid practice target.");
    if (value.overlap === "new" && value.targetSkill !== null)
      throw new TypeError("Unexpected practice target.");
    candidate.overlap = value.overlap as PracticeCandidate["overlap"];
    candidate.targetSkill = target?.name ?? null;
    candidate.targetHash = target?.contentHash ?? null;
    candidate.targetOwned = target?.owned ?? false;
    if (value.overlap === "conflict") {
      candidate.state = "unresolved";
      candidate.reason = "conflict";
      practiceFunnel(state, context.now(), "drafted", "conflict");
      return;
    }
    const procedure = parseReusablePractice(value.practice);
    if (
      !procedure ||
      (target && procedure.name !== target.name) ||
      procedure.sourcePaths.some((p) => !evidence.some((e) => e.procedure.sourcePaths.includes(p)))
    )
      throw new TypeError("Ungrounded practice draft.");
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
  const review = await withPracticeAssignment({
    context,
    role: "reviewer",
    key: `${candidate.candidateId}:${candidate.draftHash}:${sha256(canonicalJson(binding))}`,
    paths: evidence.flatMap((e) => e.procedure.sourcePaths),
    run: async (authority) => {
      if (
        authority.agent.agentId === candidate.drafterAgentId ||
        authority.assignment.lease!.sessionId === candidate.drafterSessionId
      )
        throw new Error("review_invalid");
      const value = await callPracticeProvider({
        context,
        authority,
        kind: "review",
        key: candidate.candidateId,
        data: {
          binding,
          draft: candidate.draft,
          evidence,
          catalog: disclosePracticeCatalog(catalog),
          shapeObservationCount,
        },
        schema: reviewSchema,
        prompt:
          "Use shapeObservationCount as a confidence signal, never proof or a prerequisite. Independently review the exact skill draft against the retained sanitized evidence bundle and catalog. Check invocation and exclusion conditions, practical knowledge beyond existing rules and skills, inputs, preconditions, confirmation, stop conditions, verified steps versus assumptions, grounding, secrets, host-specific values and absence of capabilities. Echo every supplied binding. Accept exactly or reject with not_reusable, duplicate, incomplete, or ungrounded. Do not defer review to the owner.",
      });
      const review = {
        ...(value as PracticeReview),
        reviewerAgentId: authority.agent.agentId,
        reviewerSessionId: authority.assignment.lease!.sessionId,
      };
      if (
        !Array.isArray(review.evidenceHashes) ||
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
