import { posix } from "node:path";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

export interface ConvergenceSourceCapturePolicy {
  maximumRepositoryBytes: number;
  symbolicReferences: { path: string; target: string; targetKind: "file" | "directory" }[];
}

export const DEFAULT_REPOSITORY_SOURCE_BYTES = 256 * 1024 * 1024;

export function symbolicReferenceTarget(reference: { path: string; target: string }): string {
  return posix.normalize(posix.join(posix.dirname(reference.path), reference.target));
}

function safeReferencePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 500 &&
    !path.includes("\\") &&
    !path.includes(":") &&
    !path.includes("\0") &&
    !path.split("/").some((part) => !part || part === "." || part === "..") &&
    ![".git", ".lervo"].some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  );
}

/** Explicit reviewed capture bounds authorize observation only, never source or asset acceptance. */
export function parseConvergenceSourceCapturePolicy(
  value: unknown,
): ConvergenceSourceCapturePolicy {
  const policy = value as ConvergenceSourceCapturePolicy | null;
  if (
    !policy ||
    typeof policy !== "object" ||
    Object.keys(policy).sort().join() !== "maximumRepositoryBytes,symbolicReferences" ||
    !Number.isSafeInteger(policy.maximumRepositoryBytes) ||
    policy.maximumRepositoryBytes < 1 ||
    policy.maximumRepositoryBytes > 1024 * 1024 * 1024 ||
    !Array.isArray(policy.symbolicReferences) ||
    policy.symbolicReferences.length > 32 ||
    new Set(policy.symbolicReferences.map((reference) => reference?.path)).size !==
      policy.symbolicReferences.length ||
    !policy.symbolicReferences.every(
      (reference) =>
        reference !== null &&
        typeof reference === "object" &&
        Object.keys(reference).sort().join() === "path,target,targetKind" &&
        safeReferencePath(reference.path) &&
        typeof reference.target === "string" &&
        reference.target.length > 0 &&
        reference.target.length <= 500 &&
        !reference.target.startsWith("/") &&
        !/[\\:\0]/u.test(reference.target) &&
        safeReferencePath(symbolicReferenceTarget(reference)) &&
        ["file", "directory"].includes(reference.targetKind),
    )
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  return structuredClone(policy);
}
