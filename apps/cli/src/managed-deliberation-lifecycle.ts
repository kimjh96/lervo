import type { ProjectStorage } from "@lervo/project-storage";

import { ManagedDeliberationError } from "./managed-deliberation-errors.js";
import type {
  ManagedDeliberationDependencies,
  ManagedDeliberationOutcome,
  ManagedDeliberationRequest,
} from "./managed-deliberation.js";

export async function executeManagedDeliberationLifecycle(input: {
  request: ManagedDeliberationRequest;
  dependencies: ManagedDeliberationDependencies;
  assignedDeliberationId?: string;
  expectedProjectId?: string;
  executeWithStorage(
    request: ManagedDeliberationRequest,
    storage: ProjectStorage,
    dependencies: ManagedDeliberationDependencies,
    assignedDeliberationId?: string,
  ): Promise<ManagedDeliberationOutcome>;
}): Promise<ManagedDeliberationOutcome> {
  let storage: ProjectStorage | undefined;
  let executionFailure: unknown;
  let result: ManagedDeliberationOutcome | undefined;
  try {
    storage = await input.dependencies.openStorage(input.request.repositoryRoot);
    if (
      input.expectedProjectId !== undefined &&
      storage.manifest.projectId !== input.expectedProjectId
    ) {
      throw new ManagedDeliberationError(
        "deliberation_project_mismatch",
        "The conversation deliberation project does not match the repository manifest.",
      );
    }
    result = await input.executeWithStorage(
      input.request,
      storage,
      input.dependencies,
      input.assignedDeliberationId,
    );
  } catch (error) {
    executionFailure = error;
  }

  let cleanupFailure: unknown;
  if (storage !== undefined) {
    try {
      await storage.close();
    } catch (error) {
      cleanupFailure = error;
    }
  }
  if (cleanupFailure !== undefined) {
    throw new ManagedDeliberationError(
      "deliberation_cleanup_failed",
      executionFailure === undefined
        ? "Project storage could not be closed after deliberation."
        : "Project storage also could not be closed after deliberation failed.",
      { cause: executionFailure === undefined
        ? cleanupFailure
        : new AggregateError([executionFailure, cleanupFailure]) },
    );
  }
  if (executionFailure !== undefined) throw executionFailure;
  if (result === undefined) throw new Error("The deliberation result is missing.");
  return result;
}
