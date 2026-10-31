import {
  canonicalJson,
  parseReusablePractice,
  sha256,
  stableId,
  type ReusablePractice,
} from "@lervo/repository-knowledge";
import type { InstructionCaptureContext } from "./instruction-capture-assessment.js";
import type { PracticeState, PracticeWorkRecord } from "./practice-state.js";
import { practiceFunnel } from "./practice-state.js";
import { retainPracticeEvidence } from "./practice-evidence.js";
import { appendPracticeEvent } from "./practice-events.js";

export const PRACTICE_ASSESSMENT_PROMPT =
  "Extract reusable practical knowledge from the observed completed work, regardless of owner teaching or language. An ordinary directive turn is eligible. Return practice:null for one-off work. A procedure needs a goal, invocation and exclusion conditions, inputs, preconditions, steps, confirmation, stop conditions, verified parts and assumptions. Ground every verified claim in the supplied observed outcomes. Never infer a pass from an assistant claim.";

/** One observed successful turn is sufficient. Repetition affects ordering only. */
export async function settlePracticeAssessment(input: {
  context: InstructionCaptureContext;
  state: PracticeState;
  work: PracticeWorkRecord;
  value: unknown;
  readRoots: string[];
  ownerResponse?: { digest: string; excerpt: string };
}): Promise<void> {
  const { context, state, work } = input;
  if (state.assessed.some((a) => a.workDigest === work.workDigest)) return;
  const now = context.now();
  const mark = () => state.assessed.push({ workDigest: work.workDigest, at: now.toISOString() });
  if (!work.complete || work.outcome !== "passed") {
    practiceFunnel(
      state,
      now,
      "assessed",
      work.complete ? "verification_unavailable" : "source_incomplete",
    );
    mark();
    return;
  }
  let procedure: ReusablePractice | null;
  try {
    procedure = parseReusablePractice(input.value);
  } catch {
    practiceFunnel(state, now, "assessed", "source_incomplete");
    mark();
    return;
  }
  if (procedure === null) {
    practiceFunnel(state, now, "assessed", "not_reusable");
    mark();
    return;
  }
  let evidence;
  try {
    evidence = await retainPracticeEvidence(
      context.storage.paths.repositoryRoot,
      work,
      procedure,
      input.readRoots,
      input.ownerResponse,
    );
  } catch {
    practiceFunnel(state, now, "assessed", "source_incomplete");
    mark();
    return;
  }
  const { name: _name, description: _description, ...meaning } = procedure;
  const practiceDigest = sha256(canonicalJson(meaning));
  const candidateId = stableId("kpc", { practiceDigest, firstWorkDigest: work.workDigest });
  const prior = state.candidates.find(
    (c) => c.practiceDigest === practiceDigest && c.reason !== "assessment_expired",
  );
  if (prior) {
    if (
      prior.state === "reviewed_rejected" &&
      !(["incomplete", "ungrounded"].includes(prior.reason ?? "") && prior.redrafts < 1)
    ) {
      practiceFunnel(state, now, "assessed", prior.reason ?? "duplicate");
      mark();
      return;
    }
    if (prior.state === "reviewed_rejected") {
      prior.redrafts += 1;
      prior.workDigests = [];
      prior.evidenceHashes = [];
      prior.state = "assessed";
      prior.review = null;
      prior.draft = null;
      prior.draftHash = null;
      prior.observedAt = now.toISOString();
    }
    prior.workDigests = [...new Set([...prior.workDigests, work.workDigest])].slice(-16);
    prior.evidenceHashes = [...new Set([...prior.evidenceHashes, evidence.evidenceHash])].slice(
      -16,
    );
  } else {
    state.candidates.push({
      candidateId,
      practiceDigest,
      workDigests: [work.workDigest],
      evidenceHashes: [evidence.evidenceHash],
      observedAt: now.toISOString(),
      state: "assessed",
      overlap: "new",
      targetSkill: null,
      targetHash: null,
      targetOwned: false,
      catalogDigest: sha256("unassessed-catalog"),
      draft: null,
      draftHash: null,
      drafterAgentId: null,
      drafterSessionId: null,
      review: null,
      reason: null,
      redrafts: 0,
      commit: null,
    });
    appendPracticeEvent(context.storage, "learning.observation.recorded", {
      observationId: candidateId,
      agentId: null,
      surface: "terminal",
      kind: "portable_skill",
      sourceEventId: work.turnEventId,
      verificationStatus: "passed",
      occurredAt: now.toISOString(),
    });
  }
  state.evidence.push(evidence);
  practiceFunnel(state, now, "assessed_with_practice");
  mark();
}
