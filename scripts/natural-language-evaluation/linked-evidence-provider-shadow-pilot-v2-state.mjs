import { randomUUID } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { stableJson, valueDigest } from "./linked-evidence-shadow-phase-a-pilot-contract.mjs";

export function providerShadowV2Paths(repositoryRoot, pilotId) {
  const pilotsRoot = resolve(
    repositoryRoot,
    ".lervo/state/search/linked-evidence-provider-shadow-pilots",
  );
  const root = resolve(pilotsRoot, pilotId);
  return {
    pilotsRoot,
    root,
    controller: resolve(root, "controller"),
    observations: resolve(root, "observations"),
    prepared: resolve(root, "controller/prepared.json"),
    attempt: resolve(root, "controller/attempt.json"),
    execution: resolve(root, "controller/execution.json"),
    failure: resolve(root, "controller/failure.json"),
    recovery: resolve(root, "controller/recovery.json"),
    review: resolve(root, "controller/review.json"),
  };
}

export async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error !== null && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
}

async function ensureOwnerDirectory(path) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
}

async function validateReadBack(path, value) {
  const observed = JSON.parse(await readFile(path, "utf8"));
  if (stableJson(observed) !== stableJson(value)) {
    throw new Error("provider_shadow_storage_failed");
  }
  return { value: observed, digest: valueDigest(observed) };
}

export async function writeOwnerJsonAtomic(path, value) {
  await ensureOwnerDirectory(path);
  const temporaryPath = `${path}.tmp-${randomUUID().replaceAll("-", "")}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return validateReadBack(path, value);
}

export async function writeOwnerJsonImmutable(path, value) {
  await ensureOwnerDirectory(path);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  await chmod(path, 0o600);
  return validateReadBack(path, value);
}

async function fileCount(path) {
  if (!(await pathExists(path))) return 0;
  return (await readdir(path, { withFileTypes: true })).filter((item) => item.isFile()).length;
}

export async function providerShadowV2StateCounts(paths) {
  return {
    attempt: Number(await pathExists(paths.attempt)),
    execution: Number(await pathExists(paths.execution)),
    failure: Number(await pathExists(paths.failure)),
    review: Number(await pathExists(paths.review)),
    observation: await fileCount(paths.observations),
    recovery: Number(await pathExists(paths.recovery)),
  };
}

export async function readOwnerJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
