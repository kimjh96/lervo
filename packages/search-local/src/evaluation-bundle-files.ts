import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, readdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertSearchEvaluationBundle,
  SEARCH_EVALUATION_MAX_BUNDLES,
  type SearchEvaluationBundle,
  type SearchEvaluationCase,
} from "@lervo/search";
import { parse, stringify } from "yaml";

import {
  SEARCH_EVALUATION_BUNDLE_FILE,
  SEARCH_EVALUATION_CASE_FILE,
  searchEvaluationDirectory,
} from "./evaluation-file-common.js";
import { SearchLocalError } from "./types.js";

const MAX_BUNDLE_BYTES = 64 * 1024;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function scopeKey(bundle: SearchEvaluationBundle): string {
  return `${bundle.scope.roleId}:${bundle.scope.taskType}`;
}

async function readBundle(path: string): Promise<SearchEvaluationBundle> {
  let handle;
  try {
    const before = await lstat(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(MAX_BUNDLE_BYTES)) {
      throw new SearchLocalError("evaluation_bundle_invalid", "검색 평가 묶음이 안전한 일반 파일이 아닙니다.");
    }
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
      throw new SearchLocalError("evaluation_bundle_invalid", "검색 평가 묶음이 읽는 동안 바뀌었습니다.");
    }
    const value = parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as SearchEvaluationBundle;
    assertSearchEvaluationBundle(value);
    return value;
  } catch (error) {
    if (error instanceof SearchLocalError) throw error;
    throw new SearchLocalError("evaluation_bundle_invalid", "검색 평가 묶음 YAML이 유효하지 않습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  } finally {
    await handle?.close();
  }
}

export async function loadSearchEvaluationBundles(input: {
  repositoryRoot: string;
  cases: readonly SearchEvaluationCase[];
}): Promise<SearchEvaluationBundle[]> {
  const directory = await searchEvaluationDirectory({
    repositoryRoot: input.repositoryRoot,
    create: false,
    errorCode: "evaluation_bundle_read_failed",
    subject: "검색 평가 묶음",
  });
  if (directory === null) return [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw new SearchLocalError("evaluation_bundle_read_failed", "검색 평가 묶음 목록을 읽지 못했습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
  const bundleEntries = entries.filter((entry) => SEARCH_EVALUATION_BUNDLE_FILE.test(entry.name));
  if (bundleEntries.length > SEARCH_EVALUATION_MAX_BUNDLES) {
    throw new SearchLocalError("evaluation_bundle_limit_exceeded", "검색 평가 묶음 수가 32개를 넘었습니다.");
  }
  const bundles: SearchEvaluationBundle[] = [];
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    const match = SEARCH_EVALUATION_BUNDLE_FILE.exec(entry.name);
    if (SEARCH_EVALUATION_CASE_FILE.test(entry.name) && entry.isFile() && !entry.isSymbolicLink()) continue;
    if (!entry.isFile() || entry.isSymbolicLink() || match === null) {
      throw new SearchLocalError("evaluation_bundle_invalid", "검색 평가 디렉터리에 계약 밖 항목이 있습니다.");
    }
    const bundle = await readBundle(resolve(directory, entry.name));
    if (bundle.bundleId !== match[1]) {
      throw new SearchLocalError("evaluation_bundle_invalid", "검색 평가 묶음 파일명과 bundle ID가 다릅니다.");
    }
    assertSearchEvaluationBundle(bundle, input.cases);
    bundles.push(bundle);
  }
  if (new Set(bundles.map(scopeKey)).size !== bundles.length) {
    throw new SearchLocalError("evaluation_bundle_invalid", "같은 역할·작업 유형에 활성 검색 평가 묶음이 중복되었습니다.");
  }
  return bundles;
}

export async function recordSearchEvaluationBundle(
  repositoryRoot: string,
  bundle: SearchEvaluationBundle,
  cases: readonly SearchEvaluationCase[],
): Promise<void> {
  assertSearchEvaluationBundle(bundle, cases);
  const existingBundles = await loadSearchEvaluationBundles({ repositoryRoot, cases });
  if (existingBundles.some((existing) => existing.bundleId !== bundle.bundleId &&
    scopeKey(existing) === scopeKey(bundle))) {
    throw new SearchLocalError("evaluation_bundle_write_failed", "같은 역할·작업 유형의 평가 묶음이 이미 있습니다.");
  }
  const directory = (await searchEvaluationDirectory({
    repositoryRoot,
    create: true,
    errorCode: "evaluation_bundle_read_failed",
    subject: "검색 평가 묶음",
  }))!;
  const path = resolve(directory, `${bundle.bundleId}.bundle.yaml`);
  const staging = resolve(directory, `.pending-${randomUUID()}`);
  try {
    const handle = await open(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      await handle.writeFile(stringify(bundle, { lineWidth: 0 }), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(staging, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readBundle(path);
      if (existing.bundleHash !== bundle.bundleHash) {
        throw new SearchLocalError("evaluation_bundle_write_failed", "같은 bundle ID에 다른 평가 묶음이 있습니다.");
      }
    }
  } catch (error) {
    if (error instanceof SearchLocalError) throw error;
    throw new SearchLocalError("evaluation_bundle_write_failed", "검색 평가 묶음을 저장하지 못했습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  } finally {
    await unlink(staging).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
}
