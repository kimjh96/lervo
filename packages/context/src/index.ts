export * from "./discovery.js";
export * from "./collections.js";
export * from "./evidence.js";
export * from "./filesystem.js";
export * from "./freshness.js";
export * from "./generated-source-exclusions.js";
export * from "./linked-evidence-shadow.js";
export * from "./managed-linked-evidence-canary.js";
export * from "./managed-linked-evidence-selection.js";
export * from "./loading.js";
export * from "./loaded-validation.js";
export * from "./paths.js";
export * from "./plan-validation.js";
export * from "./prepare.js";
export * from "./selection.js";
export * from "./types.js";
export * from "./preparation-observation.js";
export * from "./quality-request.js";
export * from "./quality-plan.js";
export type { ContextQualitySourceBytes } from "./quality-sections.js";
export * from "./quality-readiness.js";

export {
  generatedInstructionPaths,
  readInstructionSource,
  type InstructionSource,
} from "./instruction-sources.js";
export { resolveInstructionScope, type InstructionApplicability } from "./instruction-scope.js";

export * from "./instruction-packing.js";

export { resolveInstructionPrecedence } from "./instruction-precedence.js";
export type { InstructionTargets } from "./instruction-conditions.js";

export { selectEvidenceSections, type ExactEvidenceSection } from "./evidence-sections.js";
export { projectTaskQuery, taskQueryProjectorBuild } from "./task-query-projection.js";

export { protectedMarkdownDigests } from "./protected-markdown.js";
