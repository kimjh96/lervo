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
          "대화 숙의 project binding이 유효하지 않습니다.",
        );
      }
      this.projects.set(binding.projectId, repositoryRoot);
      repositoryRoots.add(repositoryRoot);
    }
    if (this.projects.size === 0) {
      throw new ManagedConversationDeliberationExecutionError(
        "deliberation_job_invalid",
        "대화 숙의 project binding이 하나 이상 필요합니다.",
      );
    }
  }

  require(projectId: string): string {
    const repositoryRoot = this.projects.get(projectId);
    if (repositoryRoot === undefined) {
      throw new ManagedConversationDeliberationExecutionError(
        "deliberation_project_not_configured",
        "대화 숙의 project에 연결된 저장소가 없습니다.",
      );
    }
    return repositoryRoot;
  }
}
