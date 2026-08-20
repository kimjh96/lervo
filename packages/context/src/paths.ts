import { createHash } from "node:crypto";
import { isAbsolute, posix, resolve, win32 } from "node:path";

import { ContextPreparationError } from "./types.js";

export function compareCanonicalText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function normalizeRepositoryPath(path: string): string {
  const normalizedSeparators = path.replaceAll("\\", "/");
  if (
    normalizedSeparators.length === 0 ||
    normalizedSeparators.includes("\0") ||
    isAbsolute(path) ||
    win32.isAbsolute(path) ||
    normalizedSeparators.split("/").some((segment) => segment === "..")
  ) {
    throw new ContextPreparationError(
      "invalid_expected_path",
      `저장소 상대 경로만 사용할 수 있습니다: ${path}`,
    );
  }
  const normalized = posix.normalize(normalizedSeparators).replace(/^\.\//, "");
  if (normalized === "." || normalized.startsWith("../")) {
    throw new ContextPreparationError(
      "invalid_expected_path",
      `저장소 상대 경로만 사용할 수 있습니다: ${path}`,
    );
  }
  return normalized;
}

export function resolveInsideRepository(root: string, path: string): string {
  const normalized = normalizeRepositoryPath(path);
  return resolve(root, ...normalized.split("/"));
}

export function documentIdForPath(path: string): string {
  const digest = createHash("sha256").update(normalizeRepositoryPath(path)).digest("hex");
  return `doc_path_${digest.slice(0, 24)}`;
}

export function instructionPathsFor(expectedPaths: readonly string[]): string[] {
  const paths = new Set<string>(["AGENTS.md"]);
  for (const inputPath of expectedPaths) {
    const normalized = normalizeRepositoryPath(inputPath);
    const segments = normalized.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      paths.add(`${segments.slice(0, index).join("/")}/AGENTS.md`);
    }
  }
  return [...paths].sort((left, right) => {
    const depth = left.split("/").length - right.split("/").length;
    return depth === 0 ? compareCanonicalText(left, right) : depth;
  });
}
