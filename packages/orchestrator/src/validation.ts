import { normalizeRepositoryPath, type LoadedContext } from "@lervo/context";

import {
  type FileChangeRecord,
  type FileWriteRequest,
  ManagedContextError,
  type ManagedContextRunOptions,
} from "./types.js";

export const sha256Pattern = /^sha256:[a-f0-9]{64}$/;

const coordinatePatterns = {
  projectId: /^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/,
  runId: /^run_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/,
  sessionId: /^ses_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/,
  roleId: /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/,
} as const;

export function validateRunOptions(options: ManagedContextRunOptions): number {
  const initialGeneration = options.initialContextGeneration ?? 0;
  if (!Number.isSafeInteger(initialGeneration) || initialGeneration < 0) {
    throw new ManagedContextError(
      "context_contract_invalid",
      "초기 context generation은 0 이상의 안전한 정수여야 합니다.",
    );
  }
  if (
    !coordinatePatterns.projectId.test(options.coordinates.projectId) ||
    !coordinatePatterns.runId.test(options.coordinates.runId) ||
    !coordinatePatterns.sessionId.test(options.coordinates.sessionId) ||
    !coordinatePatterns.roleId.test(options.coordinates.roleId) ||
    !sha256Pattern.test(options.policyVersion)
  ) {
    throw new ManagedContextError(
      "context_contract_invalid",
      "Managed run 좌표와 policy version이 유효하지 않습니다.",
    );
  }
  return initialGeneration;
}

export function assertPreparedBinding(
  loaded: LoadedContext,
  options: ManagedContextRunOptions,
): void {
  const coordinates = loaded.plan.coordinates;
  if (
    coordinates.projectId !== options.coordinates.projectId ||
    coordinates.runId !== options.coordinates.runId ||
    coordinates.sessionId !== options.coordinates.sessionId ||
    coordinates.roleId !== options.coordinates.roleId ||
    loaded.plan.evidence.some(
      (evidence) =>
        evidence.state === "selected" && evidence.policyVersion !== options.policyVersion,
    )
  ) {
    throw new ManagedContextError(
      "context_contract_invalid",
      "Prepared context가 managed run 좌표 또는 policy version과 다릅니다.",
    );
  }
}

export function validateWriteRequest(input: FileWriteRequest): string {
  if (!sha256Pattern.test(input.targetDigest) || input.risk.trim().length === 0) {
    throw new ManagedContextError(
      "context_contract_invalid",
      "파일 쓰기 대상 digest와 risk가 유효해야 합니다.",
    );
  }
  try {
    return normalizeRepositoryPath(input.path);
  } catch {
    throw new ManagedContextError(
      "context_contract_invalid",
      "파일 쓰기 대상은 안전한 저장소 상대 경로여야 합니다.",
    );
  }
}

export function normalizeExpectedWritePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map((path) => normalizeRepositoryPath(path)))].sort();
}

export function validateFileChange(input: FileChangeRecord): string {
  let normalizedPath: string;
  try {
    normalizedPath = normalizeRepositoryPath(input.path);
  } catch {
    throw new ManagedContextError(
      "context_contract_invalid",
      "파일 변경 경로는 안전한 저장소 상대 경로여야 합니다.",
    );
  }
  const hashesValid =
    (input.beforeHash === null || sha256Pattern.test(input.beforeHash)) &&
    (input.afterHash === null || sha256Pattern.test(input.afterHash)) &&
    ((input.changeKind === "created" && input.beforeHash === null && input.afterHash !== null) ||
      (input.changeKind === "modified" &&
        input.beforeHash !== null &&
        input.afterHash !== null &&
        input.beforeHash !== input.afterHash) ||
      (input.changeKind === "deleted" && input.beforeHash !== null && input.afterHash === null));
  if (!hashesValid) {
    throw new ManagedContextError(
      "context_contract_invalid",
      "파일 변경 종류와 before/after hash가 일치해야 합니다.",
    );
  }
  return normalizedPath;
}
