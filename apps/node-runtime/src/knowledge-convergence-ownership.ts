import type { ProjectStorage } from "@lervo/project-storage";
import { ConvergenceOwnership } from "@lervo/repository-knowledge-runtime";
import { createHubKnowledgeConvergenceOwnerClient } from "@lervo/sync";

/** Composes the ADR-0466 owner with the Hub lease adapter for Node-hosted knowledge residents. */
export function createKnowledgeConvergenceOwnership(
  storage: ProjectStorage,
  provider: "codex" | "claude",
): ConvergenceOwnership {
  return new ConvergenceOwnership({
    storage,
    provider,
    transport: (target) => createHubKnowledgeConvergenceOwnerClient(target),
  });
}
