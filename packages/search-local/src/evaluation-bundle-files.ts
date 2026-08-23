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
      throw new SearchLocalError("evaluation_bundle_invalid", "The search evaluation bundle is not a safe regular file.");
    }
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
      throw new SearchLocalError("evaluation_bundle_invalid", "The search evaluation bundle changed while it was being read.");
    }
    const value = parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as SearchEvaluationBundle;
    assertSearchEvaluationBundle(value);
    return value;
  } catch (error) {
    if (error instanceof SearchLocalError) throw error;
    throw new SearchLocalError("evaluation_bundle_invalid", "The search evaluation bundle YAML is invalid.", {
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
    subject: "search evaluation bundle",
  });
  if (directory === null) return [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw new SearchLocalError("evaluation_bundle_read_failed", "Could not read the search evaluation bundle list.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
  const bundleEntries = entries.filter((entry) => SEARCH_EVALUATION_BUNDLE_FILE.test(entry.name));
  if (bundleEntries.length > SEARCH_EVALUATION_MAX_BUNDLES) {
    throw new SearchLocalError("evaluation_bundle_limit_exceeded", "The number of search evaluation bundles exceeds 32.");
  }
  const bundles: SearchEvaluationBundle[] = [];
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    const match = SEARCH_EVALUATION_BUNDLE_FILE.exec(entry.name);
    if (SEARCH_EVALUATION_CASE_FILE.test(entry.name) && entry.isFile() && !entry.isSymbolicLink()) continue;
    if (!entry.isFile() || entry.isSymbolicLink() || match === null) {
      throw new SearchLocalError("evaluation_bundle_invalid", "The search evaluation directory contains an entry outside the contract.");
    }
    const bundle = await readBundle(resolve(directory, entry.name));
    if (bundle.bundleId !== match[1]) {
      throw new SearchLocalError("evaluation_bundle_invalid", "The search evaluation bundle filename does not match the bundle ID.");
    }
    assertSearchEvaluationBundle(bundle, input.cases);
    bundles.push(bundle);
  }
  if (new Set(bundles.map(scopeKey)).size !== bundles.length) {
    throw new SearchLocalError("evaluation_bundle_invalid", "More than one active search evaluation bundle exists for the same role and task type.");
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
    throw new SearchLocalError("evaluation_bundle_write_failed", "An evaluation bundle already exists for the same role and task type.");
  }
  const directory = (await searchEvaluationDirectory({
    repositoryRoot,
    create: true,
    errorCode: "evaluation_bundle_read_failed",
    subject: "search evaluation bundle",
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
        throw new SearchLocalError("evaluation_bundle_write_failed", "A different evaluation bundle exists for the same bundle ID.");
      }
    }
  } catch (error) {
    if (error instanceof SearchLocalError) throw error;
    throw new SearchLocalError("evaluation_bundle_write_failed", "Could not save the search evaluation bundle.", {
      cause: error instanceof Error ? error : undefined,
    });
  } finally {
    await unlink(staging).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
}
