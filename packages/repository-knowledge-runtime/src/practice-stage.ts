import { reusablePracticeSchema } from "@lervo/repository-knowledge";
import type { InstructionCaptureContext } from "./instruction-capture-assessment.js";
import { listQueuedInstructionCaptures } from "./instruction-capture-queue.js";
import { compactPracticeState, readPracticeState, writePracticeState } from "./practice-store.js";
import { loadConvergenceDelegation } from "./delegation.js";
import { practiceFunnel, practiceShapeSupport } from "./practice-state.js";
import { loadPracticeCatalog } from "./practice-catalog.js";
import { PRACTICE_ASSESSMENT_PROMPT, settlePracticeAssessment } from "./practice-assessment.js";
import { withPracticeAssignment } from "./practice-assignment.js";
import { callPracticeProvider } from "./practice-provider.js";
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
        !state.assessed.some((a) => a.workDigest === w.workDigest),
    );
    if (work) {
      if (!work.complete || work.outcome !== "passed") {
        await settlePracticeAssessment({ context, state, work, value: null, readRoots: [] });
        return;
      }
      const catalog = await loadPracticeCatalog(root, loaded.delegation, state);
      const result = await withPracticeAssignment({
        context,
        role: "generator",
        key: work.workDigest,
        paths: [],
        run: (authority) =>
          callPracticeProvider({
            context,
            authority,
            kind: "assessment",
            key: work.workDigest,
            data: disclosePracticeWork(work, catalog.readRoots, catalog.readablePaths),
            prompt: PRACTICE_ASSESSMENT_PROMPT,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: { practice: { anyOf: [{ type: "null" }, reusablePracticeSchema] } },
              required: ["practice"],
            },
          }),
      });
      await settlePracticeAssessment({
        context,
        state,
        work,
        value: (result as { practice?: unknown } | null)?.practice,
        readRoots: catalog.readRoots,
      });
      return;
    }
    let candidates = state.candidates.filter((c) =>
      ["assessed", "unresolved", "drafted", "reviewed_accepted"].includes(c.state),
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
    for (const candidate of candidates.slice(0, 1)) {
      if (candidate.state === "reviewed_accepted") {
        if (effects === "write") await materializePractice(context, state, candidate);
      } else await draftOrReviewPractice(context, state, candidate);
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
