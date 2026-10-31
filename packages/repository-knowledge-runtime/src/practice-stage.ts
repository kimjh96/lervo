import { canonicalJson, reusablePracticeSchema } from "@lervo/repository-knowledge";
import type { InstructionCaptureContext } from "./instruction-capture-assessment.js";
import { listQueuedInstructionCaptures } from "./instruction-capture-queue.js";
import { compactPracticeState, readPracticeState, writePracticeState } from "./practice-store.js";
import { loadConvergenceDelegation } from "./delegation.js";
import { practiceFunnel, practiceShapeSupport } from "./practice-state.js";
import { loadPracticeCatalog } from "./practice-catalog.js";
import { PRACTICE_ASSESSMENT_PROMPT, settlePracticeAssessment } from "./practice-assessment.js";
import { withPracticeProviderAssignment } from "./practice-provider-assignment.js";
import { practiceReady, practiceResumeAt } from "./practice-deferral.js";
import { draftOrReviewPractice } from "./practice-draft.js";
import { materializePractice } from "./practice-materialization.js";
import { assessPracticeUsage } from "./practice-usage.js";
import { disclosePracticeWork } from "./practice-disclosure.js";
import { appendPracticeEvent } from "./practice-events.js";

const failures = new Set([
  "source_incomplete",
  "verification_unavailable",
  "review_invalid",
  "target_changed",
  "publication_authority_missing",
  "usage_coverage_unknown",
  "provider_not_admitted",
  "assessment_expired",
  "practice_budget_exhausted",
  "foreground_pending",
]);

/** One lower-priority call per cycle; owner-turn capture has already had first admission. */
export async function runPracticeLearningCycle(
  context: InstructionCaptureContext,
  effects: "observe" | "write",
): Promise<void> {
  const root = context.storage.paths.repositoryRoot;
  const state = await readPracticeState(root);
  compactPracticeState(state, context.now());
  for (const candidate of state.candidates.filter((c) => c.reason === "assessment_expired"))
    appendPracticeEvent(context.storage, "knowledge.skill_candidate.resolved", {
      candidateId: candidate.candidateId,
      decision: "expired",
      reasonCode: "assessment_expired",
      reviewerAgentId: null,
      reviewedDraftHash: candidate.draftHash,
      catalogDigest: candidate.catalogDigest,
      occurredAt: new Date(Date.parse(candidate.observedAt) + 7 * 86_400_000).toISOString(),
    });
  try {
    if (
      (context.providerQuantum !== undefined && context.providerQuantum.remaining <= 0) ||
      (await listQueuedInstructionCaptures(root)).length ||
      (await context.liveWorkPending())
    )
      return;
    const loaded = await loadConvergenceDelegation(root);
    if (!loaded) {
      if (state.works.length)
        practiceFunnel(state, context.now(), "assessed", "provider_not_admitted");
      return;
    }
    if (await assessPracticeUsage(context, state, effects)) return;
    const work = state.works.find(
      (w) =>
        context.now().getTime() - Date.parse(w.observedAt) >= 30 * 60_000 &&
        !state.assessed.some((a) => a.workDigest === w.workDigest) &&
        practiceReady(w, context.now()),
    );
    if (work) {
      if (!work.complete || work.outcome !== "passed") {
        await settlePracticeAssessment({ context, state, work, value: null, readRoots: [] });
        return;
      }
      const catalog = await loadPracticeCatalog(root, loaded.delegation, state);
      const data = disclosePracticeWork(work, catalog.readRoots, catalog.readablePaths);
      try {
        const result = await withPracticeProviderAssignment({
          context,
          role: "generator",
          assignmentKey: work.workDigest,
          paths: [],
          kind: "assessment",
          key: work.workDigest,
          data,
          beforeCall: async () => {
            const current = await loadConvergenceDelegation(root);
            if (!current) throw new Error("provider_not_admitted");
            const permissions = await loadPracticeCatalog(root, current.delegation, state);
            if (
              canonicalJson(
                disclosePracticeWork(data, permissions.readRoots, permissions.readablePaths),
              ) !== canonicalJson(data)
            )
              throw new Error("source_incomplete");
          },
          prompt: PRACTICE_ASSESSMENT_PROMPT,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: { practice: { anyOf: [{ type: "null" }, reusablePracticeSchema] } },
            required: ["practice"],
          },
          resolve: (value) => value,
        });
        await settlePracticeAssessment({
          context,
          state,
          work,
          value: (result as { practice?: unknown } | null)?.practice,
          readRoots: catalog.readRoots,
          readablePaths: catalog.readablePaths,
        });
        return;
      } catch (error) {
        const resumeAt = practiceResumeAt(error, context.now());
        if (resumeAt === null) throw error;
        work.resumeAt = resumeAt;
        practiceFunnel(
          state,
          context.now(),
          "waiting",
          error instanceof Error ? error.message : "provider_not_admitted",
        );
      }
    }
    let candidates = state.candidates.filter(
      (c) =>
        ["assessed", "unresolved", "drafted", "reviewed_accepted"].includes(c.state) &&
        (effects === "write" || c.state !== "reviewed_accepted") &&
        practiceReady(c, context.now()),
    );
    if (candidates.some((c) => c.state === "unresolved")) {
      const catalog = await loadPracticeCatalog(root, loaded.delegation, state);
      candidates = candidates.filter(
        (c) => c.state !== "unresolved" || c.catalogDigest !== catalog.digest,
      );
    }
    candidates.sort(
      (a, b) =>
        practiceShapeSupport(state, b.workDigests) - practiceShapeSupport(state, a.workDigests) ||
        a.observedAt.localeCompare(b.observedAt),
    );
    for (const candidate of candidates) {
      try {
        if (candidate.state === "reviewed_accepted") {
          if (effects === "write") await materializePractice(context, state, candidate);
        } else await draftOrReviewPractice(context, state, candidate);
        candidate.resumeAt = null;
        return;
      } catch (error) {
        const resumeAt = practiceResumeAt(error, context.now());
        if (resumeAt === null) throw error;
        candidate.resumeAt = resumeAt;
        practiceFunnel(
          state,
          context.now(),
          "waiting",
          error instanceof Error ? error.message : "provider_not_admitted",
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    practiceFunnel(
      state,
      context.now(),
      "waiting",
      failures.has(message)
        ? message
        : error instanceof TypeError
          ? "source_incomplete"
          : [
                "knowledge_provider_paused",
                "knowledge_capacity_unavailable",
                "knowledge_authority_unavailable",
              ].includes(String((error as { code?: unknown })?.code))
            ? "provider_not_admitted"
            : "assessment_failed",
    );
  } finally {
    await writePracticeState(root, state, context.now());
  }
}
