import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { canonicalJson } from "@lervo/event-contract";
import { resolveProjectPaths } from "@lervo/project";

import { SearchLocalError } from "./types.js";
import {
  sameFileAcrossStatSurfaces,
  sameFileWithinStatSurface,
} from "./stable-file-observation.js";

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
        "Could not prepare the search observation directory.",
        { cause: error instanceof Error ? error : undefined },
      );
    }
  }
  try {
    const stats = await lstat(path);
    if (!stats.isDirectory() || stats.isSymbolicLink() || (await realpath(path)) !== path) {
      throw new SearchLocalError(
        "observation_invalid",
        "The search observation path must be a real directory.",
      );
    }
  } catch (error) {
    if (error instanceof SearchLocalError) throw error;
    throw new SearchLocalError(
      "observation_read_failed",
      "Could not inspect the search observation directory.",
      {
        cause: error instanceof Error ? error : undefined,
      },
    );
  }
}

type ObservationDirectories = { attempts: string; assessments: string };
export type ObservationSubdirectory =
  | "assessments"
  | "attempts"
  | "evaluation-comparisons"
  | "engine-selections"
  | "retrieval-plan-selections"
  | "evaluation-results"
  | "evaluation-reviews"
  | "evaluation-runs"
  | "linked-evidence-shadow"
  | "linked-evidence-managed-canary"
  | "rollout-acknowledgements"
  | "rollout-reviews";

async function observationPaths(repositoryRoot: string): Promise<{ state: string; root: string }> {
  try {
    const canonicalRoot = await realpath(repositoryRoot);
    const paths = resolveProjectPaths(canonicalRoot);
    return { state: paths.state, root: paths.searchObservations };
  } catch (error) {
    throw new SearchLocalError(
      "observation_read_failed",
      "Could not inspect the search observation store root.",
      {
        cause: error instanceof Error ? error : undefined,
      },
    );
  }
}

export async function prepareObservationDirectories(
  repositoryRoot: string,
): Promise<ObservationDirectories> {
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
  await safeDirectory(paths.state, true);
  await safeDirectory(paths.root, true);
  const directory = resolve(paths.root, name);
  await safeDirectory(directory, true);
  return directory;
}

export async function existingObservationSubdirectory(
  repositoryRoot: string,
  name: ObservationSubdirectory,
): Promise<string | null> {
  const paths = await observationPaths(repositoryRoot);
  try {
    await lstat(paths.state);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  await safeDirectory(paths.state, false);
  try {
    await lstat(paths.root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new SearchLocalError(
      "observation_read_failed",
      "Could not inspect the search observation path.",
      {
        cause: error instanceof Error ? error : undefined,
      },
    );
  }
  await safeDirectory(paths.root, false);
  const directory = resolve(paths.root, name);
  try {
    await lstat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new SearchLocalError(
      "observation_read_failed",
      "Could not inspect the search observation child path.",
      {
        cause: error instanceof Error ? error : undefined,
      },
    );
  }
  await safeDirectory(directory, false);
  return directory;
}

export async function existingObservationDirectories(
  repositoryRoot: string,
): Promise<ObservationDirectories | null> {
  const paths = await observationPaths(repositoryRoot);
  try {
    await lstat(paths.state);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  await safeDirectory(paths.state, false);
  try {
    await lstat(paths.root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new SearchLocalError(
      "observation_read_failed",
      "Could not inspect the search observation path.",
      {
        cause: error instanceof Error ? error : undefined,
      },
    );
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
    const beforePath = await lstat(path, { bigint: true });
    if (
      !beforePath.isFile() ||
      beforePath.isSymbolicLink() ||
      beforePath.size > BigInt(MAX_FILE_BYTES)
    ) {
      throw new SearchLocalError(
        "observation_invalid",
        "The search observation source file is unsafe.",
      );
    }
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const openedHandle = await handle.stat({ bigint: true });
    const afterOpenPath = await lstat(path, { bigint: true });
    if (
      !openedHandle.isFile() ||
      openedHandle.size > BigInt(MAX_FILE_BYTES) ||
      !afterOpenPath.isFile() ||
      afterOpenPath.isSymbolicLink() ||
      afterOpenPath.size > BigInt(MAX_FILE_BYTES) ||
      !sameFileWithinStatSurface(beforePath, afterOpenPath) ||
      !sameFileAcrossStatSurfaces(afterOpenPath, openedHandle)
    ) {
      throw new SearchLocalError(
        "observation_invalid",
        "The search observation source path changed before it was read.",
      );
    }
    const buffer = Buffer.alloc(Number(openedHandle.size) + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const afterReadHandle = await handle.stat({ bigint: true });
    const afterReadPath = await lstat(path, { bigint: true });
    if (
      bytesRead !== Number(openedHandle.size) ||
      !afterReadHandle.isFile() ||
      afterReadHandle.size > BigInt(MAX_FILE_BYTES) ||
      !afterReadPath.isFile() ||
      afterReadPath.isSymbolicLink() ||
      afterReadPath.size > BigInt(MAX_FILE_BYTES) ||
      !sameFileWithinStatSurface(openedHandle, afterReadHandle) ||
      !sameFileWithinStatSurface(afterOpenPath, afterReadPath) ||
      !sameFileAcrossStatSurfaces(afterReadPath, afterReadHandle)
    ) {
      throw new SearchLocalError(
        "observation_invalid",
        "The search observation source changed while it was being read.",
      );
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead)),
    ) as T;
  } catch (error) {
    if (error instanceof SearchLocalError) throw error;
    throw new SearchLocalError(
      "observation_read_failed",
      "Could not read the search observation source.",
      {
        cause: error instanceof Error ? error : undefined,
      },
    );
  } finally {
    await handle?.close();
  }
}

export async function writeObservation(path: string, value: unknown): Promise<void> {
  const staging = resolve(dirname(path), `.pending-${randomUUID()}`);
  const serialized = `${canonicalJson(value)}\n`;
  try {
    try {
      const stagingHandle = await open(
        staging,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
        0o600,
      );
      try {
        await stagingHandle.writeFile(serialized, "utf8");
        await stagingHandle.sync();
      } finally {
        await stagingHandle.close();
      }
    } catch (error) {
      throw new SearchLocalError(
        "observation_write_failed",
        "Could not save the temporary search observation source.",
        {
          cause: error instanceof Error ? error : undefined,
        },
      );
    }
    try {
      await link(staging, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new SearchLocalError(
          "observation_write_failed",
          "Could not publish the search observation source.",
          {
            cause: error instanceof Error ? error : undefined,
          },
        );
      }
      if (`${canonicalJson(await readObservation(path))}\n` !== serialized) {
        throw new SearchLocalError(
          "observation_conflict",
          "A different source exists for the same search observation ID.",
        );
      }
    }
  } finally {
    try {
      await unlink(staging);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        // Fail closed: an unremoved staging source makes publication state indeterminate.
        // eslint-disable-next-line no-unsafe-finally
        throw new SearchLocalError(
          "observation_write_failed",
          "Could not clean up the temporary search observation source.",
          {
            cause: error instanceof Error ? error : undefined,
          },
        );
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
    throw new SearchLocalError(
      "observation_read_failed",
      "Could not read the search observation list.",
      {
        cause: error instanceof Error ? error : undefined,
      },
    );
  }
  if (entries.length > MAX_OBSERVATIONS) {
    throw new SearchLocalError(
      "observation_limit_exceeded",
      "The number of search observation sources exceeds the query limit.",
    );
  }
  const values: T[] = [];
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    if (!entry.isFile() || entry.isSymbolicLink() || !input.pattern.test(entry.name)) {
      throw new SearchLocalError(
        "observation_invalid",
        "The search observation directory contains an entry outside the contract.",
      );
    }
    const value = await readObservation<T>(resolve(input.path, entry.name));
    input.assertValue(value);
    const expectedFileName = input.expectedFileName?.(value);
    if (expectedFileName !== undefined && expectedFileName !== entry.name) {
      throw new SearchLocalError(
        "observation_invalid",
        "The search observation filename does not match the source coordinates.",
      );
    }
    values.push(value);
  }
  return values;
}
