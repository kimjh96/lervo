import type { ProjectStorage } from "@lervo/project-storage";
import { ConvergenceOwnership } from "@lervo/repository-knowledge-runtime";
import { createHubKnowledgeConvergenceOwnerClient } from "@lervo/sync";

/** Composes the ADR-0466 owner with the Hub lease adapter for CLI-hosted knowledge workers. */
export function createKnowledgeConvergenceOwnership(
  storage: ProjectStorage,
  provider?: "codex" | "claude",
): ConvergenceOwnership {
  return new ConvergenceOwnership({
    storage,
    ...(provider === undefined ? {} : { provider }),
    transport: (target) => createHubKnowledgeConvergenceOwnerClient(target),
  });
}
