export class KnowledgeConvergenceRuntimeError extends Error {
  constructor(
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(`Knowledge convergence requires recovery: ${code}.`, options);
    this.name = "KnowledgeConvergenceRuntimeError";
  }
}
