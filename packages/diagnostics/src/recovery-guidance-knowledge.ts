import type {
  DoctorIssueCode,
  DoctorRecoveryActionCode,
} from "./types.js";

type GuidanceMap = Partial<Record<DoctorIssueCode, {
  actionCode: DoctorRecoveryActionCode;
  message: string;
}>>;

export const knowledgeRecoveryGuidance = {
  candidate_artifact_invalid: {
    actionCode: "inspect_knowledge_candidate",
    message: "Check that the knowledge candidate source and its linked evidence files remain available.",
  },
  candidate_decision_missing: {
    actionCode: "inspect_knowledge_candidate",
    message: "Check that the deliberation decision evidence referenced by the knowledge candidate remains available.",
  },
  candidate_evidence_missing: {
    actionCode: "inspect_knowledge_candidate",
    message: "Check that the completion and verification evidence referenced by the knowledge candidate remains available.",
  },
  candidate_event_mismatch: {
    actionCode: "inspect_knowledge_candidate",
    message: "Check that the knowledge candidate source and creation record have matching relation coordinates.",
  },
  candidate_outcome_not_converged: {
    actionCode: "inspect_knowledge_candidate",
    message: "Check that a non-converged deliberation result was not recorded as a knowledge candidate.",
  },
  candidate_verification_missing: {
    actionCode: "inspect_knowledge_candidate",
    message: "Check that the verification result and repository state referenced by the knowledge candidate remain available.",
  },
  review_artifact_invalid: {
    actionCode: "inspect_knowledge_review",
    message: "Check that the knowledge review source and its linked evidence files remain available.",
  },
  review_candidate_missing: {
    actionCode: "inspect_knowledge_review",
    message: "Restore the candidate source referenced by the knowledge review, or review it again.",
  },
  review_event_mismatch: {
    actionCode: "inspect_knowledge_review",
    message: "Check that the knowledge review source and review record have matching relation coordinates.",
  },
  verified_artifact_invalid: {
    actionCode: "inspect_verified_knowledge",
    message: "Check that the verified knowledge source and its linked evidence files remain available.",
  },
  verified_candidate_missing: {
    actionCode: "inspect_verified_knowledge",
    message: "Check the candidate source referenced by the verified knowledge first.",
  },
  verified_event_mismatch: {
    actionCode: "inspect_verified_knowledge",
    message: "Check that the verified knowledge source and promotion record have matching relation coordinates.",
  },
  verified_review_missing: {
    actionCode: "inspect_verified_knowledge",
    message: "Check the human-review source referenced by the verified knowledge first.",
  },
  staleness_artifact_invalid: {
    actionCode: "inspect_knowledge_staleness",
    message: "Check that the knowledge staleness source and its linked evidence files remain available.",
  },
  staleness_event_mismatch: {
    actionCode: "inspect_knowledge_staleness",
    message: "Check that the knowledge staleness decision and record have matching relation coordinates.",
  },
  staleness_verified_missing: {
    actionCode: "inspect_knowledge_staleness",
    message: "Check the verified knowledge source referenced by the staleness decision first.",
  },
  event_chain_invalid: {
    actionCode: "inspect_event_history",
    message: "Check local execution records and recoverable backups; do not overwrite the source directly.",
  },
} satisfies GuidanceMap;
