import { lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";

import { EnvironmentError } from "./errors.js";
import type {
  EnvironmentObservation,
  EnvironmentSourceManifest,
  EnvironmentTargetManifest,
} from "./types.js";
import {
  validateEnvironmentObservation,
  validateEnvironmentSourceManifest,
  validateEnvironmentTargetManifest,
} from "./validation.js";

export const environmentRelativePaths = {
  sources: ".lervo/environment-sources",
  targets: ".lervo/environment-targets",
  admissionPolicy: ".lervo/environment-admission.yaml",
  observations: ".lervo/state/environment",
} as const;

async function loadYamlFile(
  path: string,
  notFoundCode: "environment_source_not_found" | "environment_target_not_found",
  invalidCode: "invalid_environment_source" | "invalid_environment_target",
  label: string,
): Promise<unknown> {
  let stat;
  try {
    stat = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new EnvironmentError(notFoundCode, `${label} was not found.`);
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024)
    throw new EnvironmentError(invalidCode, `${label} must be a safe regular file.`);
  try {
    return parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new EnvironmentError(
      invalidCode,
      `Could not read ${label} YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function loadEnvironmentSource(
  repositoryRoot: string,
  sourceId: string,
): Promise<EnvironmentSourceManifest> {
  if (!/^src_[a-z0-9][a-z0-9_-]{7,63}$/.test(sourceId))
    throw new EnvironmentError("invalid_environment_source", "sourceId is invalid.");
  const manifest = validateEnvironmentSourceManifest(
    await loadYamlFile(
      resolve(repositoryRoot, environmentRelativePaths.sources, `${sourceId}.source.yaml`),
      "environment_source_not_found",
      "invalid_environment_source",
      `environment source ${sourceId}`,
    ),
  );
  if (manifest.sourceId !== sourceId)
    throw new EnvironmentError(
      "invalid_environment_source",
      "The environment source filename differs from sourceId.",
    );
  return manifest;
}

export async function loadEnvironmentSources(
  repositoryRoot: string,
): Promise<EnvironmentSourceManifest[]> {
  const directory = resolve(repositoryRoot, environmentRelativePaths.sources);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const names = entries
    .filter(
      (entry) => entry.isFile() && /^src_[a-z0-9][a-z0-9_-]{7,63}\.source\.yaml$/.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
  if (names.length > 256)
    throw new EnvironmentError(
      "invalid_environment_source",
      "The environment source count exceeds 256.",
    );
  return Promise.all(
    names.map((name) =>
      loadEnvironmentSource(repositoryRoot, name.slice(0, -".source.yaml".length)),
    ),
  );
}

export async function loadEnvironmentTarget(
  repositoryRoot: string,
  targetId: string,
): Promise<EnvironmentTargetManifest> {
  if (!/^tgt_[a-z0-9][a-z0-9_-]{7,63}$/.test(targetId))
    throw new EnvironmentError("invalid_environment_target", "targetId is invalid.");
  const manifest = validateEnvironmentTargetManifest(
    await loadYamlFile(
      resolve(repositoryRoot, environmentRelativePaths.targets, `${targetId}.target.yaml`),
      "environment_target_not_found",
      "invalid_environment_target",
      `environment target ${targetId}`,
    ),
  );
  if (manifest.targetId !== targetId)
    throw new EnvironmentError(
      "invalid_environment_target",
      "The environment target filename differs from targetId.",
    );
  return manifest;
}

export async function storeEnvironmentObservation(
  repositoryRoot: string,
  observationValue: EnvironmentObservation,
): Promise<string> {
  const observation = validateEnvironmentObservation(observationValue);
  const directory = resolve(repositoryRoot, environmentRelativePaths.observations);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStat = await lstat(directory);
  if (
    !directoryStat.isDirectory() ||
    directoryStat.isSymbolicLink() ||
    (process.platform !== "win32" && (directoryStat.mode & 0o077) !== 0)
  ) {
    throw new EnvironmentError(
      "invalid_environment_observation",
      "The environment observation directory must be an owner-only regular directory.",
    );
  }
  const target = resolve(directory, `${observation.sourceId}.observation.json`);
  const temporary = resolve(directory, `.${observation.sourceId}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(observation, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  return target;
}

export async function loadEnvironmentObservations(
  repositoryRoot: string,
): Promise<EnvironmentObservation[]> {
  const directory = resolve(repositoryRoot, environmentRelativePaths.observations);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const observations: EnvironmentObservation[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !/^src_[a-z0-9][a-z0-9_-]{7,63}\.observation\.json$/.test(entry.name))
      continue;
    const path = resolve(directory, entry.name);
    const stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 2 * 1024 * 1024 ||
      (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
    ) {
      throw new EnvironmentError(
        "invalid_environment_observation",
        `The environment observation file is unsafe: ${entry.name}`,
      );
    }
    let observation: EnvironmentObservation;
    try {
      observation = validateEnvironmentObservation(
        JSON.parse(await readFile(path, "utf8")) as EnvironmentObservation,
      );
    } catch (error) {
      if (error instanceof EnvironmentError) throw error;
      throw new EnvironmentError(
        "invalid_environment_observation",
        `Could not read the environment observation JSON: ${entry.name}`,
      );
    }
    const source = await loadEnvironmentSource(repositoryRoot, observation.sourceId);
    const validitySeconds =
      (Date.parse(observation.validUntil) - Date.parse(observation.observedAt)) / 1000;
    if (
      source.adapterId !== observation.adapterId ||
      source.scope !== observation.scope ||
      validitySeconds > source.maximumValiditySeconds
    ) {
      throw new EnvironmentError(
        "invalid_environment_observation",
        `The environment observation differs from the current source declaration: ${entry.name}`,
      );
    }
    observations.push(observation);
  }
  return observations;
}
