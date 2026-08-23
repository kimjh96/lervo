import { isAbsolute, resolve } from "node:path";

export interface ManagedConversationDeliberationProjectBinding {
  projectId: string;
  repositoryRoot: string;
}

export class ManagedConversationDeliberationExecutionError extends Error {
  constructor(
    readonly code: "deliberation_job_invalid" | "deliberation_project_not_configured",
    message: string,
  ) {
    super(message);
    this.name = "ManagedConversationDeliberationExecutionError";
  }
}

export class ManagedConversationDeliberationProjects {
  private readonly projects = new Map<string, string>();

  constructor(bindings: readonly ManagedConversationDeliberationProjectBinding[]) {
    const repositoryRoots = new Set<string>();
    for (const binding of bindings) {
      const repositoryRoot = resolve(binding.repositoryRoot);
      if (
        !/^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(binding.projectId) ||
        !isAbsolute(binding.repositoryRoot) || binding.repositoryRoot.includes("\0") ||
        this.projects.has(binding.projectId) || repositoryRoots.has(repositoryRoot)
      ) {
        throw new ManagedConversationDeliberationExecutionError(
          "deliberation_job_invalid",
          "The conversation deliberation project binding is invalid.",
        );
      }
      this.projects.set(binding.projectId, repositoryRoot);
      repositoryRoots.add(repositoryRoot);
    }
    if (this.projects.size === 0) {
      throw new ManagedConversationDeliberationExecutionError(
        "deliberation_job_invalid",
        "At least one conversation deliberation project binding is required.",
      );
    }
  }

  require(projectId: string): string {
    const repositoryRoot = this.projects.get(projectId);
    if (repositoryRoot === undefined) {
      throw new ManagedConversationDeliberationExecutionError(
        "deliberation_project_not_configured",
        "No repository is bound to the conversation deliberation project.",
      );
    }
    return repositoryRoot;
  }
}
