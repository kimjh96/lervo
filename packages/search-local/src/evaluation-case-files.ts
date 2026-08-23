import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, readdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  assertSearchEvaluationCase,
  SEARCH_EVALUATION_MAX_CASES,
  type SearchEvaluationCase,
} from "@lervo/search";
import { parse, stringify } from "yaml";

import {
  SEARCH_EVALUATION_BUNDLE_FILE,
  SEARCH_EVALUATION_CASE_FILE,
  searchEvaluationDirectory,
} from "./evaluation-file-common.js";
import { SearchLocalError } from "./types.js";

const MAX_CASE_BYTES = 64 * 1024;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function readCase(path: string): Promise<SearchEvaluationCase> {
  let handle;
  try {
    const before = await lstat(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(MAX_CASE_BYTES)) {
      throw new SearchLocalError("evaluation_case_invalid", "The search evaluation case is not a safe regular file.");
    }
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
      throw new SearchLocalError("evaluation_case_invalid", "The search evaluation case changed while it was being read.");
    }
    const value = parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as SearchEvaluationCase;
    assertSearchEvaluationCase(value);
    return value;
  } catch (error) {
    if (error instanceof SearchLocalError) throw error;
    throw new SearchLocalError("evaluation_case_invalid", "The search evaluation case YAML is invalid.", {
      cause: error instanceof Error ? error : undefined,
    });
  } finally {
    await handle?.close();
  }
}

export async function loadSearchEvaluationCases(repositoryRoot: string): Promise<SearchEvaluationCase[]> {
  const directory = await searchEvaluationDirectory({
    repositoryRoot,
    create: false,
    errorCode: "evaluation_case_read_failed",
    subject: "search evaluation case",
  });
  if (directory === null) return [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw new SearchLocalError("evaluation_case_read_failed", "Could not read the search evaluation case list.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
  const caseEntries = entries.filter((entry) => SEARCH_EVALUATION_CASE_FILE.test(entry.name));
  if (caseEntries.length > SEARCH_EVALUATION_MAX_CASES) {
    throw new SearchLocalError("evaluation_case_limit_exceeded", "The number of search evaluation cases exceeds 256.");
  }
  const cases: SearchEvaluationCase[] = [];
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    const match = SEARCH_EVALUATION_CASE_FILE.exec(entry.name);
    if (SEARCH_EVALUATION_BUNDLE_FILE.test(entry.name) && entry.isFile() && !entry.isSymbolicLink()) continue;
    if (!entry.isFile() || entry.isSymbolicLink() || match === null) {
      throw new SearchLocalError("evaluation_case_invalid", "The search evaluation case directory contains an entry outside the contract.");
    }
    const evaluationCase = await readCase(resolve(directory, entry.name));
    if (evaluationCase.caseId !== match[1]) {
      throw new SearchLocalError("evaluation_case_invalid", "The search evaluation case filename does not match the case ID.");
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
  const directory = (await searchEvaluationDirectory({
    repositoryRoot,
    create: true,
    errorCode: "evaluation_case_read_failed",
    subject: "search evaluation case",
  }))!;
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
        throw new SearchLocalError("evaluation_case_write_failed", "A different evaluation case exists for the same case ID.");
      }
    }
  } catch (error) {
    if (error instanceof SearchLocalError) throw error;
    throw new SearchLocalError("evaluation_case_write_failed", "Could not save the search evaluation case.", {
      cause: error instanceof Error ? error : undefined,
    });
  } finally {
    await unlink(staging).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
}
