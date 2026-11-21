import { canonicalJson, sanitizePracticeText, sha256 } from "@lervo/repository-knowledge";
import type { InstructionCaptureContext } from "./instruction-capture-assessment.js";
import type { GeneratedPracticeSkill, PracticeState } from "./practice-state.js";
import type { PracticeVersionUsage } from "./practice-usage-projection.js";
import { loadConvergenceDelegation } from "./delegation.js";
import { loadPracticeCatalog } from "./practice-catalog.js";
import { ordinaryConvergenceSourceBytes } from "./source-file.js";
import { withPracticeProviderAssignment } from "./practice-provider-assignment.js";
import { appendPracticeEvent } from "./practice-events.js";
import { practiceUsageReviewContract } from "./practice-review-contract.js";

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
  // ADR-0604: the reviewer answers keep or retire only; Lervo binds the exact version itself.
  const contract = practiceUsageReviewContract();
  const evidenceHash = sha256(canonicalJson([usage, shapes]));
  const reviewed = await withPracticeProviderAssignment({
    context,
    role: "reviewer",
    assignmentKey: `${skill.versionHash}:retirement:${evidenceHash}`,
    paths: [skill.path],
    assertAuthority: (authority) => {
      if (
        authority.agent.agentId === candidate.drafterAgentId ||
        authority.assignment.lease!.sessionId === candidate.drafterSessionId
      )
        throw new Error("review_invalid");
    },
    kind: "review",
    key: skill.candidateId,
    beforeCall: async () => {
      const current = await loadConvergenceDelegation(root);
      if (!current) throw new Error("provider_not_admitted");
      const permissions = await loadPracticeCatalog(root, current.delegation, state);
      if (
        !permissions.complete ||
        permissions.digest !== catalog.digest ||
        !permissions.skills.some(
          (entry) => entry.path === skill.path && entry.contentHash === skill.versionHash,
        )
      )
        throw new Error("source_incomplete");
    },
    data: {
      skill: {
        name: skill.name,
        path: skill.path,
        exposedAt: skill.exposedAt,
        content: sanitizePracticeText(bytes.toString("utf8")),
      },
      usage,
      shapes,
    },
    schema: contract.schema,
    prompt:
      "Re-evaluate this exact unused skill. Consider the frequency of its trigger situation in observed work. Shapes are a ranking signal and do not prove a trigger occurred. Keep rare-task skills such as quarterly releases, and keep whenever trigger-frequency evidence is insufficient. Unknown coverage never permits retirement. Answer keep or retire only. A retire verdict proposes removal through the normal reviewed write path.",
    resolve: (value, authority) => ({
      decision: contract.parse(value),
      reviewerAgentId: authority.agent.agentId,
    }),
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
