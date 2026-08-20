import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { canonicalJson } from "@lervo/event-contract";
import { resolveProjectPaths } from "@lervo/project";

import { SearchLocalError } from "./types.js";

const MAX_OBSERVATIONS = 10_000;
const MAX_FILE_BYTES = 64 * 1024;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function safeDirectory(path: string, create: boolean): Promise<void> {
  try {
    if (create) await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw new SearchLocalError(
        create ? "observation_write_failed" : "observation_read_failed",
        "검색 관측 디렉터리를 준비하지 못했습니다.",
        { cause: error instanceof Error ? error : undefined },
      );
    }
  }
  try {
    const stats = await lstat(path);
    if (!stats.isDirectory() || stats.isSymbolicLink() || await realpath(path) !== path) {
      throw new SearchLocalError("observation_invalid", "검색 관측 경로는 실제 디렉터리여야 합니다.");
    }
  } catch (error) {
    if (error instanceof SearchLocalError) throw error;
    throw new SearchLocalError("observation_read_failed", "검색 관측 디렉터리를 확인하지 못했습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

type ObservationDirectories = { attempts: string; assessments: string };
type ObservationSubdirectory = "assessments" | "attempts" | "evaluation-comparisons" |
  "evaluation-results" | "evaluation-runs";

async function observationPaths(repositoryRoot: string): Promise<{ state: string; root: string }> {
  try {
    const canonicalRoot = await realpath(repositoryRoot);
    const paths = resolveProjectPaths(canonicalRoot);
    return { state: paths.state, root: paths.searchObservations };
  } catch (error) {
    throw new SearchLocalError("observation_read_failed", "검색 관측 저장소 root를 확인하지 못했습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

export async function prepareObservationDirectories(repositoryRoot: string): Promise<ObservationDirectories> {
  const [attempts, assessments] = await Promise.all([
    prepareObservationSubdirectory(repositoryRoot, "attempts"),
    prepareObservationSubdirectory(repositoryRoot, "assessments"),
  ]);
  return { attempts, assessments };
}

export async function prepareObservationSubdirectory(
  repositoryRoot: string,
  name: ObservationSubdirectory,
): Promise<string> {
  const paths = await observationPaths(repositoryRoot);
  await safeDirectory(paths.state, false);
  await safeDirectory(paths.root, true);
  const directory = resolve(paths.root, name);
  await safeDirectory(directory, true);
  return directory;
}

export async function existingObservationDirectories(
  repositoryRoot: string,
): Promise<ObservationDirectories | null> {
  const paths = await observationPaths(repositoryRoot);
  await safeDirectory(paths.state, false);
  try {
    await lstat(paths.root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new SearchLocalError("observation_read_failed", "검색 관측 경로를 확인하지 못했습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
  await safeDirectory(paths.root, false);
  const attempts = resolve(paths.root, "attempts");
  const assessments = resolve(paths.root, "assessments");
  await safeDirectory(attempts, false);
  await safeDirectory(assessments, false);
  return { attempts, assessments };
}

export async function readObservation<T>(path: string): Promise<T> {
  let handle;
  try {
    const before = await lstat(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(MAX_FILE_BYTES)) {
      throw new SearchLocalError("observation_invalid", "검색 관측 원본 파일이 안전하지 않습니다.");
    }
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat({ bigint: true });
    if (before.dev !== opened.dev || before.ino !== opened.ino || opened.size > BigInt(MAX_FILE_BYTES)) {
      throw new SearchLocalError("observation_invalid", "검색 관측 원본 경로가 읽기 전에 바뀌었습니다.");
    }
    const buffer = Buffer.alloc(Number(opened.size) + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const after = await handle.stat({ bigint: true });
    if (bytesRead !== Number(opened.size) || opened.size !== after.size || opened.mtimeNs !== after.mtimeNs) {
      throw new SearchLocalError("observation_invalid", "검색 관측 원본이 읽는 동안 바뀌었습니다.");
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead))) as T;
  } catch (error) {
    if (error instanceof SearchLocalError) throw error;
    throw new SearchLocalError("observation_read_failed", "검색 관측 원본을 읽지 못했습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  } finally {
    await handle?.close();
  }
}

export async function writeObservation(path: string, value: unknown): Promise<void> {
  const staging = resolve(dirname(path), `.pending-${randomUUID()}`);
  const serialized = `${canonicalJson(value)}\n`;
  try {
    try {
      const stagingHandle = await open(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      try {
        await stagingHandle.writeFile(serialized, "utf8");
        await stagingHandle.sync();
      } finally {
        await stagingHandle.close();
      }
    } catch (error) {
      throw new SearchLocalError("observation_write_failed", "검색 관측 임시 원본을 저장하지 못했습니다.", {
        cause: error instanceof Error ? error : undefined,
      });
    }
    try {
      await link(staging, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new SearchLocalError("observation_write_failed", "검색 관측 원본을 게시하지 못했습니다.", {
          cause: error instanceof Error ? error : undefined,
        });
      }
      if (`${canonicalJson(await readObservation(path))}\n` !== serialized) {
        throw new SearchLocalError("observation_conflict", "같은 검색 관측 ID에 다른 원본이 있습니다.");
      }
    }
  } finally {
    try {
      await unlink(staging);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new SearchLocalError("observation_write_failed", "검색 관측 임시 원본을 정리하지 못했습니다.", {
          cause: error instanceof Error ? error : undefined,
        });
      }
    }
  }
}

export async function listObservations<T>(input: {
  path: string;
  pattern: RegExp;
  assertValue: (value: T) => void;
  expectedFileName?: (value: T) => string;
}): Promise<T[]> {
  let entries;
  try {
    entries = await readdir(input.path, { withFileTypes: true });
  } catch (error) {
    throw new SearchLocalError("observation_read_failed", "검색 관측 목록을 읽지 못했습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
  if (entries.length > MAX_OBSERVATIONS) {
    throw new SearchLocalError("observation_limit_exceeded", "검색 관측 원본 수가 조회 한도를 넘었습니다.");
  }
  const values: T[] = [];
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    if (!entry.isFile() || entry.isSymbolicLink() || !input.pattern.test(entry.name)) {
      throw new SearchLocalError("observation_invalid", "검색 관측 디렉터리에 계약 밖 항목이 있습니다.");
    }
    const value = await readObservation<T>(resolve(input.path, entry.name));
    input.assertValue(value);
    const expectedFileName = input.expectedFileName?.(value);
    if (expectedFileName !== undefined && expectedFileName !== entry.name) {
      throw new SearchLocalError("observation_invalid", "검색 관측 파일명과 원본 좌표가 다릅니다.");
    }
    values.push(value);
  }
  return values;
}
