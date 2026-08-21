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
        "대화 숙의 project와 저장소 manifest가 일치하지 않습니다.",
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
        ? "숙의 뒤 project storage를 닫지 못했습니다."
        : "숙의 실패 뒤 project storage도 닫지 못했습니다.",
      { cause: executionFailure === undefined
        ? cleanupFailure
        : new AggregateError([executionFailure, cleanupFailure]) },
    );
  }
  if (executionFailure !== undefined) throw executionFailure;
  if (result === undefined) throw new Error("숙의 결과가 없습니다.");
  return result;
}
