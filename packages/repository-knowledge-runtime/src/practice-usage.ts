import { reviewPracticeUsage } from "./practice-usage-review.js";
import type { EventEnvelope } from "@lervo/schemas";
import type { InstructionCaptureContext } from "./instruction-capture-assessment.js";
import { practiceFunnel, type PracticeState } from "./practice-state.js";
import { projectPracticeVersionUsage } from "./practice-usage-projection.js";
import { appendPracticeEvent } from "./practice-events.js";
import { readConvergenceOwnerHost } from "./convergence-owner-host.js";
import { readKnowledgePublicationState } from "./knowledge-publication-state.js";
import { loadConvergenceDelegation } from "./delegation.js";
import { terminalSkillRevisionFiles } from "./terminal-skill-revision-files.js";
import { sha256 } from "@lervo/repository-knowledge";
import { retirePracticeSkill } from "./practice-retirement.js";
import { observePracticeExposure } from "./practice-exposure.js";
import { practiceReady, practiceResumeAt } from "./practice-deferral.js";

const usageEventTypes: readonly string[] = [
  "terminal.turn.observed",
  "terminal.skill.observed",
  "terminal.skill.turn_assessed",
  "skill.resolved",
  "skill.invoked",
  "capability.loaded",
  "conversation.repository_work.completed",
  "run.requested",
];

/** Usage is assessed daily. A missing host exchange or provider surface always preserves unknown. */
export async function assessPracticeUsage(
  context: InstructionCaptureContext,
  state: PracticeState,
  effects: "observe" | "write",
): Promise<boolean> {
  if (!state.generated.length) return false;
  const root = context.storage.paths.repositoryRoot;
  const events: EventEnvelope[] = [];
  let afterSeq = 0;
  let bounded = true;
  // ADR-0554: a typed read costs only the usage events; the bound counts what is retained.
  while (true) {
    const page = context.storage.events.list({ afterSeq, limit: 1000, types: usageEventTypes });
    if (!page.length) break;
    for (const e of page)
      if (
        Date.parse(e.occurredAt) >= context.now().getTime() - 91 * 86_400_000 &&
        usageEventTypes.includes(e.type)
      )
        events.push(e);
    afterSeq = page.at(-1)!.seq;
    if (events.length > 100_000) {
      bounded = false;
      break;
    }
  }
  const host = await readConvergenceOwnerHost(root);
  const allHostsObserved = bounded && host?.config.coordination.mode !== "hub";
  const publication = await readKnowledgePublicationState(root);
  const delegation = await loadConvergenceDelegation(root);
  if (!delegation) return false;
  const target = await (
    await import("./integration-target-sync.js")
  ).resolveIntegrationTarget(root, delegation.delegation.integrationTarget.ref);
  const files = target === null ? null : await terminalSkillRevisionFiles(root, target);
  for (const skill of state.generated) {
    const candidate = state.candidates.find((c) => c.candidateId === skill.candidateId);
    if (!candidate) continue;
    if (
      candidate.state === "materialized" &&
      publication?.publishedHead &&
      ["open", "awaiting_checks", "merged", "local_diverged"].includes(publication.status)
    ) {
      // Publication must contain the exact version, not merely some unrelated knowledge commit.
      const published = await terminalSkillRevisionFiles(root, publication.publishedHead).catch(
        () => null,
      );
      const bytes = await published?.read(skill.path);
      if (bytes && sha256(bytes) === skill.versionHash) {
        candidate.state = "published";
        practiceFunnel(state, context.now(), "published");
      }
    }
    const present = await files?.read(skill.path);
    const previouslyExposed = skill.exposedAt !== null;
    observePracticeExposure({
      skill,
      present: !!present && sha256(present) === skill.versionHash,
      events,
      notBefore: candidate.observedAt,
      now: context.now(),
    });
    if (!previouslyExposed && skill.exposedAt !== null) {
      candidate.state = "exposed";
      practiceFunnel(state, context.now(), "exposed");
    }
    const usage = projectPracticeVersionUsage({
      skill,
      events,
      now: context.now(),
      allHostsObserved,
      generated: true,
    });
    appendPracticeEvent(context.storage, "knowledge.skill.usage_assessed", {
      skillName: skill.name,
      versionHash: skill.versionHash,
      usageState: usage.usageState,
      observedTurns: usage.observedTurns,
      coverage: usage.coverage,
      occurredAt: `${context.now().toISOString().slice(0, 10)}T00:00:00.000Z`,
    });
    if (usage.usageState === "used" && candidate.state !== "used") {
      candidate.state = "used";
      practiceFunnel(state, context.now(), "used");
    }
    if (
      !usage.reevaluate ||
      skill.reevaluatedAt !== null ||
      effects !== "write" ||
      !practiceReady(skill, context.now())
    )
      continue;
    try {
      const verdict = await reviewPracticeUsage(context, state, skill, usage);
      if (verdict === "retire") await retirePracticeSkill(context, state, skill, usage);
      skill.reevaluatedAt = context.now().toISOString();
      skill.resumeAt = null;
      return true;
    } catch (error) {
      const resumeAt = practiceResumeAt(error, context.now());
      if (resumeAt === null) throw error;
      skill.resumeAt = resumeAt;
    }
  }
  return false;
}
