export {
  structuralKnowledgeLintCodes,
  normalizationKnowledgeLintCodes,
  instructionBridgeKnowledgeLintCodes,
  repositoryLayoutKnowledgeLintCodes,
  validateKnowledgeStage,
} from "@lervo/repository-knowledge";

/** A stage that rewrites AGENTS.md or CLAUDE.md is expected to leave the bridge binding stale. */
export function expectedInstructionBridgeTransitions(
  operations: ReadonlyArray<{ path: string; action: string }>,
): ReadonlySet<string> {
  return new Set(
    operations.some(
      (operation) =>
        operation.action !== "unchanged" &&
        (operation.path === "AGENTS.md" || operation.path === "CLAUDE.md"),
    )
      ? ["instruction_bridge_binding_stale"]
      : [],
  );
}
