// Shared with the node-runtime worker so every host applies stored owner rules (ADR-0594).
export {
  applyStoredInstructionCandidates,
  type InstructionCandidateApplyResult,
} from "@lervo/repository-knowledge-runtime";
