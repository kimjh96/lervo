import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import { resolve } from "node:path";

import { resolveProjectPaths } from "@lervo/project";
import {
  assertSearchEngineActivationPolicy,
  SEARCH_ENGINE_ACTIVATION_POLICY_PATTERN,
  type SearchEngineActivationPolicy,
} from "@lervo/search";
import { parse, stringify } from "yaml";

import { SearchLocalError } from "./types.js";

const MAX_POLICY_BYTES = 64 * 1024;
const MAX_POLICIES = 32;

async function policyDirectory(repositoryRoot: string, create: boolean): Promise<string | null> {
  try {
    const root = await realpath(repositoryRoot);
    const paths = resolveProjectPaths(root);
    const lervo = await lstat(paths.lervoRoot);
    if (!lervo.isDirectory() || lervo.isSymbolicLink() || await realpath(paths.lervoRoot) !== paths.lervoRoot) {
      throw new Error("unsafe lervo root");
    }
    if (create) await mkdir(paths.searchEnginePolicies, { mode: 0o700 }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });
    else {
      try {
        await lstat(paths.searchEnginePolicies);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    }
    const stats = await lstat(paths.searchEnginePolicies);
    if (!stats.isDirectory() || stats.isSymbolicLink() ||
      await realpath(paths.searchEnginePolicies) !== paths.searchEnginePolicies) {
      throw new Error("unsafe search engine policy directory");
    }
    return paths.searchEnginePolicies;
  } catch (error) {
    throw new SearchLocalError("engine_policy_read_failed", "검색 엔진 활성화 정책 디렉터리를 확인하지 못했습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

async function readPolicy(path: string): Promise<SearchEngineActivationPolicy> {
  let handle;
  try {
    const before = await lstat(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(MAX_POLICY_BYTES)) {
      throw new SearchLocalError("engine_policy_invalid", "검색 엔진 활성화 정책이 안전한 일반 파일이 아닙니다.");
    }
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
      throw new SearchLocalError("engine_policy_invalid", "검색 엔진 활성화 정책이 읽는 동안 바뀌었습니다.");
    }
    const policy = parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as SearchEngineActivationPolicy;
    assertSearchEngineActivationPolicy(policy);
    return policy;
  } catch (error) {
    if (error instanceof SearchLocalError) throw error;
    throw new SearchLocalError("engine_policy_invalid", "검색 엔진 활성화 정책 YAML이 유효하지 않습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  } finally {
    await handle?.close();
  }
}

export async function loadSearchEngineActivationPolicies(
  repositoryRoot: string,
): Promise<SearchEngineActivationPolicy[]> {
  const directory = await policyDirectory(repositoryRoot, false);
  if (directory === null) return [];
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    throw new SearchLocalError("engine_policy_read_failed", "검색 엔진 활성화 정책 목록을 읽지 못했습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  });
  if (entries.length > MAX_POLICIES) {
    throw new SearchLocalError("engine_policy_invalid", "검색 엔진 활성화 정책 수가 32개를 넘었습니다.");
  }
  const policies: SearchEngineActivationPolicy[] = [];
  for (const entry of entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
    const match = /^(sepol_[a-f0-9]{24})\.yaml$/.exec(entry.name);
    if (!entry.isFile() || entry.isSymbolicLink() || match === null) {
      throw new SearchLocalError("engine_policy_invalid", "검색 엔진 활성화 정책 디렉터리에 계약 밖 항목이 있습니다.");
    }
    const policy = await readPolicy(resolve(directory, entry.name));
    if (policy.policyId !== match[1]) {
      throw new SearchLocalError("engine_policy_invalid", "검색 엔진 활성화 정책 ID가 파일명과 다릅니다.");
    }
    policies.push(policy);
  }
  return policies;
}

export async function loadSearchEngineActivationPolicy(
  repositoryRoot: string,
  policyId: string,
): Promise<SearchEngineActivationPolicy> {
  if (!SEARCH_ENGINE_ACTIVATION_POLICY_PATTERN.test(policyId)) {
    throw new SearchLocalError("engine_policy_not_found", "검색 엔진 활성화 정책 ID가 유효하지 않습니다.");
  }
  const policies = await loadSearchEngineActivationPolicies(repositoryRoot);
  const policy = policies.find((item) => item.policyId === policyId);
  if (policy === undefined) {
    throw new SearchLocalError("engine_policy_not_found", "검색 엔진 활성화 정책을 찾을 수 없습니다.");
  }
  return policy;
}

export async function recordSearchEngineActivationPolicy(
  repositoryRoot: string,
  policy: SearchEngineActivationPolicy,
): Promise<void> {
  assertSearchEngineActivationPolicy(policy);
  const existing = await loadSearchEngineActivationPolicies(repositoryRoot);
  if (existing.length >= MAX_POLICIES && !existing.some((item) => item.policyId === policy.policyId)) {
    throw new SearchLocalError("engine_policy_write_failed", "검색 엔진 활성화 정책 수가 32개를 넘습니다.");
  }
  const directory = (await policyDirectory(repositoryRoot, true))!;
  const path = resolve(directory, `${policy.policyId}.yaml`);
  const staging = resolve(directory, `.pending-${randomUUID()}`);
  try {
    const handle = await open(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      await handle.writeFile(stringify(policy, { lineWidth: 0 }), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(staging, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if ((await readPolicy(path)).policyId !== policy.policyId) {
        throw new SearchLocalError("engine_policy_write_failed", "같은 정책 ID에 다른 원본이 있습니다.");
      }
    }
  } catch (error) {
    if (error instanceof SearchLocalError) throw error;
    throw new SearchLocalError("engine_policy_write_failed", "검색 엔진 활성화 정책을 저장하지 못했습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  } finally {
    await unlink(staging).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
}
