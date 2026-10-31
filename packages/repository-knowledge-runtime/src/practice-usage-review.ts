import {
  canonicalJson,
  practiceReviewValid,
  sanitizePracticeText,
  sha256,
  type PracticeReview,
} from "@lervo/repository-knowledge";
import type { InstructionCaptureContext } from "./instruction-capture-assessment.js";
import type { GeneratedPracticeSkill, PracticeState } from "./practice-state.js";
import type { PracticeVersionUsage } from "./practice-usage-projection.js";
import { loadConvergenceDelegation } from "./delegation.js";
import { loadPracticeCatalog } from "./practice-catalog.js";
import { ordinaryConvergenceSourceBytes } from "./source-file.js";
import { withPracticeAssignment } from "./practice-assignment.js";
import { callPracticeProvider } from "./practice-provider.js";
import { appendPracticeEvent } from "./practice-events.js";

export async function reviewPracticeUsage(
  context: InstructionCaptureContext,
  state: PracticeState,
  skill: GeneratedPracticeSkill,
  usage: PracticeVersionUsage,
): Promise<"keep" | "retire"> {
  if (!usage.reevaluate || usage.usageState !== "unused_with_coverage")
    throw new Error("usage_coverage_unknown");
  const candidate = state.candidates.find((c) => c.candidateId === skill.candidateId);
  if (!candidate?.drafterAgentId || !candidate.drafterSessionId) throw new Error("review_invalid");
  const root = context.storage.paths.repositoryRoot;
  const delegation = await loadConvergenceDelegation(root);
  if (!delegation) throw new Error("provider_not_admitted");
  const catalog = await loadPracticeCatalog(root, delegation.delegation, state);
  const bytes = ordinaryConvergenceSourceBytes(root, skill.path, 8192);
  if (sha256(bytes) !== skill.versionHash || !catalog.complete) throw new Error("target_changed");
  const shapeCounts = new Map<string, { steps: string[]; count: number }>();
  for (const shape of state.shapes) {
    const row = shapeCounts.get(shape.digest) ?? { steps: shape.steps, count: 0 };
    row.count++;
    shapeCounts.set(shape.digest, row);
  }
  const shapes = [...shapeCounts.values()].sort((a, b) => b.count - a.count).slice(0, 20);
  const binding = {
    draftHash: skill.versionHash,
    targetHash: skill.versionHash,
    catalogDigest: catalog.digest,
    evidenceHashes: [sha256(canonicalJson([usage, shapes]))],
  };
  const reviewed = await withPracticeAssignment({
    context,
    role: "reviewer",
    key: `${skill.versionHash}:retirement:${binding.evidenceHashes[0]}`,
    paths: [skill.path],
    run: async (authority) => {
      if (
        authority.agent.agentId === candidate.drafterAgentId ||
        authority.assignment.lease!.sessionId === candidate.drafterSessionId
      )
        throw new Error("review_invalid");
      const result = (await callPracticeProvider({
        context,
        authority,
        kind: "review",
        key: skill.candidateId,
        data: {
          binding,
          skill: { ...skill, content: sanitizePracticeText(bytes.toString("utf8")) },
          usage,
          shapes,
        },
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            decision: { enum: ["keep", "retire"] },
            draftHash: { type: "string" },
            targetHash: { type: "string" },
            catalogDigest: { type: "string" },
            evidenceHashes: { type: "array", items: { type: "string" } },
          },
          required: ["decision", "draftHash", "targetHash", "catalogDigest", "evidenceHashes"],
        },
        prompt:
          "Re-evaluate this exact unused skill. Consider the frequency of its trigger situation in observed work. Shapes are a ranking signal and do not prove a trigger occurred. Keep rare-task skills such as quarterly releases, and keep whenever trigger-frequency evidence is insufficient. Unknown coverage never permits retirement. Echo every supplied binding. A retire verdict proposes removal through the normal reviewed write path.",
      })) as Omit<PracticeReview, "decision"> & { decision: "keep" | "retire" };
      const review = {
        ...result,
        decision: "accept" as const,
        reasonCode: "accepted" as const,
        reviewerAgentId: authority.agent.agentId,
        reviewerSessionId: authority.assignment.lease!.sessionId,
      };
      if (
        !Array.isArray(result.evidenceHashes) ||
        !practiceReviewValid({
          expected: binding,
          review,
          drafterAgentId: candidate.drafterAgentId!,
          drafterSessionId: candidate.drafterSessionId!,
        }) ||
        !["keep", "retire"].includes(result.decision)
      )
        throw new Error("review_invalid");
      return { decision: result.decision, reviewerAgentId: authority.agent.agentId };
    },
  });
  appendPracticeEvent(context.storage, "knowledge.skill_candidate.resolved", {
    candidateId: skill.candidateId,
    decision: reviewed.decision,
    reasonCode: reviewed.decision === "keep" ? "retained" : "unused_with_coverage",
    reviewerAgentId: reviewed.reviewerAgentId,
    reviewedDraftHash: skill.versionHash,
    catalogDigest: catalog.digest,
    occurredAt: context.now().toISOString(),
  });
  return reviewed.decision;
}
