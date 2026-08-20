import { lstat, mkdir, realpath } from "node:fs/promises";

import { resolveProjectPaths } from "@lervo/project";

import { SearchLocalError, type SearchLocalErrorCode } from "./types.js";

export const SEARCH_EVALUATION_CASE_FILE = /^(sec_[a-f0-9]{24})\.yaml$/;
export const SEARCH_EVALUATION_BUNDLE_FILE = /^([a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,7})\.bundle\.yaml$/;

export async function searchEvaluationDirectory(input: {
  repositoryRoot: string;
  create: boolean;
  errorCode: Extract<SearchLocalErrorCode, "evaluation_case_read_failed" | "evaluation_bundle_read_failed">;
  subject: string;
}): Promise<string | null> {
  try {
    const canonicalRoot = await realpath(input.repositoryRoot);
    const paths = resolveProjectPaths(canonicalRoot);
    const lervo = await lstat(paths.lervoRoot);
    if (!lervo.isDirectory() || lervo.isSymbolicLink() || await realpath(paths.lervoRoot) !== paths.lervoRoot) {
      throw new Error("unsafe lervo root");
    }
    if (input.create) await mkdir(paths.searchEvaluations, { mode: 0o700 }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });
    else {
      try {
        await lstat(paths.searchEvaluations);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    }
    const stats = await lstat(paths.searchEvaluations);
    if (!stats.isDirectory() || stats.isSymbolicLink() ||
      await realpath(paths.searchEvaluations) !== paths.searchEvaluations) {
      throw new Error("unsafe search evaluation directory");
    }
    return paths.searchEvaluations;
  } catch (error) {
    if (error instanceof SearchLocalError) throw error;
    throw new SearchLocalError(input.errorCode, `${input.subject} 디렉터리를 확인하지 못했습니다.`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}
