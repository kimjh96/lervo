import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { resolveProjectPaths } from "@lervo/project";
import {
  assertSearchEvaluationCase,
  SEARCH_EVALUATION_MAX_CASES,
  type SearchEvaluationCase,
} from "@lervo/search";
import { parse, stringify } from "yaml";

import { SearchLocalError } from "./types.js";

const CASE_FILE = /^(sec_[a-f0-9]{24})\.yaml$/;
const MAX_CASE_BYTES = 64 * 1024;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function evaluationDirectory(repositoryRoot: string, create: boolean): Promise<string | null> {
  try {
    const canonicalRoot = await realpath(repositoryRoot);
    const paths = resolveProjectPaths(canonicalRoot);
    const lervo = await lstat(paths.lervoRoot);
    if (!lervo.isDirectory() || lervo.isSymbolicLink() || await realpath(paths.lervoRoot) !== paths.lervoRoot) {
      throw new Error("unsafe lervo root");
    }
    if (create) await mkdir(paths.searchEvaluations, { mode: 0o700 }).catch((error) => {
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
      await realpath(paths.searchEvaluations) !== paths.searchEvaluations) throw new Error("unsafe case directory");
    return paths.searchEvaluations;
  } catch (error) {
    if (error instanceof SearchLocalError) throw error;
    throw new SearchLocalError("evaluation_case_read_failed", "검색 평가 케이스 디렉터리를 확인하지 못했습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

async function readCase(path: string): Promise<SearchEvaluationCase> {
  let handle;
  try {
    const before = await lstat(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(MAX_CASE_BYTES)) {
      throw new SearchLocalError("evaluation_case_invalid", "검색 평가 케이스가 안전한 일반 파일이 아닙니다.");
    }
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
      throw new SearchLocalError("evaluation_case_invalid", "검색 평가 케이스가 읽는 동안 바뀌었습니다.");
    }
    const value = parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as SearchEvaluationCase;
    assertSearchEvaluationCase(value);
    return value;
  } catch (error) {
    if (error instanceof SearchLocalError) throw error;
    throw new SearchLocalError("evaluation_case_invalid", "검색 평가 케이스 YAML이 유효하지 않습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  } finally {
    await handle?.close();
  }
}

export async function loadSearchEvaluationCases(repositoryRoot: string): Promise<SearchEvaluationCase[]> {
  const directory = await evaluationDirectory(repositoryRoot, false);
  if (directory === null) return [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw new SearchLocalError("evaluation_case_read_failed", "검색 평가 케이스 목록을 읽지 못했습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
  if (entries.length > SEARCH_EVALUATION_MAX_CASES) {
    throw new SearchLocalError("evaluation_case_limit_exceeded", "검색 평가 케이스 수가 256개를 넘었습니다.");
  }
  const cases: SearchEvaluationCase[] = [];
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    const match = CASE_FILE.exec(entry.name);
    if (!entry.isFile() || entry.isSymbolicLink() || match === null) {
      throw new SearchLocalError("evaluation_case_invalid", "검색 평가 케이스 디렉터리에 계약 밖 항목이 있습니다.");
    }
    const evaluationCase = await readCase(resolve(directory, entry.name));
    if (evaluationCase.caseId !== match[1]) {
      throw new SearchLocalError("evaluation_case_invalid", "검색 평가 케이스 파일명과 case ID가 다릅니다.");
    }
    cases.push(evaluationCase);
  }
  return cases;
}

export async function recordSearchEvaluationCase(
  repositoryRoot: string,
  evaluationCase: SearchEvaluationCase,
): Promise<void> {
  assertSearchEvaluationCase(evaluationCase);
  const directory = (await evaluationDirectory(repositoryRoot, true))!;
  const path = resolve(directory, `${evaluationCase.caseId}.yaml`);
  const staging = resolve(dirname(path), `.pending-${randomUUID()}`);
  const serialized = stringify(evaluationCase, { lineWidth: 0 });
  try {
    const handle = await open(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(staging, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readCase(path);
      if (existing.caseId !== evaluationCase.caseId) {
        throw new SearchLocalError("evaluation_case_write_failed", "같은 case ID에 다른 평가 케이스가 있습니다.");
      }
    }
  } catch (error) {
    if (error instanceof SearchLocalError) throw error;
    throw new SearchLocalError("evaluation_case_write_failed", "검색 평가 케이스를 저장하지 못했습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  } finally {
    await unlink(staging).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
}
