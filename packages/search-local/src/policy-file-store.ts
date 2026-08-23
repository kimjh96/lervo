import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import { resolve } from "node:path";

import { resolveProjectPaths, type LervoProjectPaths } from "@lervo/project";
import { parse, stringify } from "yaml";

import { SearchLocalError, type SearchLocalErrorCode } from "./types.js";

const MAX_POLICY_BYTES = 64 * 1024;

export interface LocalPolicyFileContract<T> {
  label: string;
  directory: (paths: LervoProjectPaths) => string;
  idPattern: RegExp;
  id: (value: T) => string;
  assertValue: (value: T) => void;
  maximumFiles: number;
  errors: {
    invalid: SearchLocalErrorCode;
    notFound: SearchLocalErrorCode;
    readFailed: SearchLocalErrorCode;
    writeFailed: SearchLocalErrorCode;
  };
}

async function policyDirectory<T>(
  repositoryRoot: string,
  contract: LocalPolicyFileContract<T>,
  create: boolean,
): Promise<string | null> {
  try {
    const root = await realpath(repositoryRoot);
    const paths = resolveProjectPaths(root);
    const lervo = await lstat(paths.lervoRoot);
    if (!lervo.isDirectory() || lervo.isSymbolicLink() || await realpath(paths.lervoRoot) !== paths.lervoRoot) {
      throw new Error("unsafe lervo root");
    }
    const directory = contract.directory(paths);
    if (create) await mkdir(directory, { mode: 0o700 }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });
    else {
      try {
        await lstat(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    }
    const stats = await lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink() || await realpath(directory) !== directory) {
      throw new Error("unsafe policy directory");
    }
    return directory;
  } catch (error) {
    throw new SearchLocalError(contract.errors.readFailed, `Could not inspect the ${contract.label} directory.`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

async function readPolicy<T>(path: string, contract: LocalPolicyFileContract<T>): Promise<T> {
  let handle;
  try {
    const before = await lstat(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(MAX_POLICY_BYTES)) {
      throw new SearchLocalError(contract.errors.invalid, `The ${contract.label} is not a safe regular file.`);
    }
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
      throw new SearchLocalError(contract.errors.invalid, `The ${contract.label} changed while it was being read.`);
    }
    const value = parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
    contract.assertValue(value);
    return value;
  } catch (error) {
    if (error instanceof SearchLocalError) throw error;
    throw new SearchLocalError(contract.errors.invalid, `The ${contract.label} YAML is invalid.`, {
      cause: error instanceof Error ? error : undefined,
    });
  } finally {
    await handle?.close();
  }
}

export async function loadLocalPolicyFiles<T>(input: {
  repositoryRoot: string;
  contract: LocalPolicyFileContract<T>;
}): Promise<T[]> {
  const directory = await policyDirectory(input.repositoryRoot, input.contract, false);
  if (directory === null) return [];
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    throw new SearchLocalError(input.contract.errors.readFailed, `Could not read the ${input.contract.label} list.`, {
      cause: error instanceof Error ? error : undefined,
    });
  });
  if (entries.length > input.contract.maximumFiles) {
    throw new SearchLocalError(
      input.contract.errors.invalid,
      `The number of ${input.contract.label} files exceeds ${input.contract.maximumFiles}.`,
    );
  }
  const values: T[] = [];
  for (const entry of entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
    const match = /^(.+)\.yaml$/.exec(entry.name);
    if (!entry.isFile() || entry.isSymbolicLink() || match === null || !input.contract.idPattern.test(match[1]!)) {
      throw new SearchLocalError(input.contract.errors.invalid, `The ${input.contract.label} directory contains an entry outside the contract.`);
    }
    const value = await readPolicy(resolve(directory, entry.name), input.contract);
    if (input.contract.id(value) !== match[1]) {
      throw new SearchLocalError(input.contract.errors.invalid, `The ${input.contract.label} ID does not match the filename.`);
    }
    values.push(value);
  }
  return values;
}

export async function loadLocalPolicyFile<T>(input: {
  repositoryRoot: string;
  policyId: string;
  contract: LocalPolicyFileContract<T>;
}): Promise<T> {
  if (!input.contract.idPattern.test(input.policyId)) {
    throw new SearchLocalError(input.contract.errors.notFound, `The ${input.contract.label} ID is invalid.`);
  }
  const values = await loadLocalPolicyFiles(input);
  const value = values.find((item) => input.contract.id(item) === input.policyId);
  if (value === undefined) {
    throw new SearchLocalError(input.contract.errors.notFound, `The ${input.contract.label} was not found.`);
  }
  return value;
}

export async function recordLocalPolicyFile<T>(input: {
  repositoryRoot: string;
  value: T;
  contract: LocalPolicyFileContract<T>;
}): Promise<void> {
  input.contract.assertValue(input.value);
  const policyId = input.contract.id(input.value);
  const existing = await loadLocalPolicyFiles({ repositoryRoot: input.repositoryRoot, contract: input.contract });
  if (existing.length >= input.contract.maximumFiles &&
    !existing.some((item) => input.contract.id(item) === policyId)) {
    throw new SearchLocalError(
      input.contract.errors.writeFailed,
      `The number of ${input.contract.label} files exceeds ${input.contract.maximumFiles}.`,
    );
  }
  const directory = (await policyDirectory(input.repositoryRoot, input.contract, true))!;
  const path = resolve(directory, `${policyId}.yaml`);
  const staging = resolve(directory, `.pending-${randomUUID()}`);
  try {
    const handle = await open(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      await handle.writeFile(stringify(input.value, { lineWidth: 0 }), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(staging, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (input.contract.id(await readPolicy(path, input.contract)) !== policyId) {
        throw new SearchLocalError(input.contract.errors.writeFailed, `A different source exists for the same ${input.contract.label} ID.`);
      }
    }
  } catch (error) {
    if (error instanceof SearchLocalError) throw error;
    throw new SearchLocalError(input.contract.errors.writeFailed, `Could not save the ${input.contract.label}.`, {
      cause: error instanceof Error ? error : undefined,
    });
  } finally {
    await unlink(staging).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
}
