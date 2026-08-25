import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";

import { loadProjectManifest, resolveProjectPaths } from "@lervo/project";

import type {
  RegisterRepositoryResult,
  RepositoryRegistration,
  RepositoryRegistry,
} from "./types.js";

const maximumRegistryBytes = 1024 * 1024;
const maximumRepositories = 256;
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const projectIdPattern = /^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;

export class RepositoryRegistryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RepositoryRegistryError";
  }
}

function fail(code: string, message: string): never {
  throw new RepositoryRegistryError(code, message);
}

function absoluteRegistryPath(path: string): string {
  if (!isAbsolute(path) || /[\0\r\n]/u.test(path)) {
    fail("repository_registry_path_invalid", "The registry must use a safe absolute path.");
  }
  return resolve(path);
}

function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  );
}

function validRegistration(value: unknown): value is RepositoryRegistration {
  return (
    exactKeys(value, ["projectId", "name", "repositoryRoot", "manifestSha256", "registeredAt"]) &&
    typeof value.projectId === "string" &&
    projectIdPattern.test(value.projectId) &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    value.name.length <= 128 &&
    typeof value.repositoryRoot === "string" &&
    isAbsolute(value.repositoryRoot) &&
    !/[\0\r\n]/u.test(value.repositoryRoot) &&
    typeof value.manifestSha256 === "string" &&
    digestPattern.test(value.manifestSha256) &&
    typeof value.registeredAt === "string" &&
    Number.isFinite(Date.parse(value.registeredAt))
  );
}

export function validateRepositoryRegistry(value: unknown): RepositoryRegistry {
  if (
    !exactKeys(value, ["schemaVersion", "kind", "repositories"]) ||
    value.schemaVersion !== 1 ||
    value.kind !== "lervo_repository_registry" ||
    !Array.isArray(value.repositories) ||
    value.repositories.length > maximumRepositories ||
    !value.repositories.every(validRegistration)
  ) {
    fail("repository_registry_invalid", "The repository registry structure is invalid.");
  }
  const registrations = value.repositories as RepositoryRegistration[];
  for (let index = 0; index < registrations.length; index += 1) {
    const current = registrations[index]!;
    const previous = registrations[index - 1];
    if (previous !== undefined && previous.projectId >= current.projectId) {
      fail(
        "repository_registry_invalid",
        "The repository registry is unsorted or contains duplicate project IDs.",
      );
    }
    if (
      registrations.some(
        (entry, other) => other !== index && entry.repositoryRoot === current.repositoryRoot,
      )
    ) {
      fail("repository_registry_invalid", "The repository registry contains duplicate roots.");
    }
  }
  return value as unknown as RepositoryRegistry;
}

export function defaultRepositoryRegistryPath(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const override = environment.LERVO_USER_STATE_DIRECTORY;
  if (override !== undefined) {
    if (!isAbsolute(override) || /[\0\r\n]/u.test(override))
      fail(
        "repository_registry_path_invalid",
        "LERVO_USER_STATE_DIRECTORY must be a safe absolute path.",
      );
    return resolve(override, "repositories.json");
  }
  if (process.platform === "darwin")
    return resolve(homedir(), "Library", "Application Support", "Lervo", "repositories.json");
  if (process.platform === "win32") {
    const local = environment.LOCALAPPDATA;
    if (local === undefined || !isAbsolute(local))
      fail(
        "repository_registry_path_invalid",
        "The registry path cannot be resolved from LOCALAPPDATA.",
      );
    return resolve(local, "Lervo", "repositories.json");
  }
  return resolve(
    environment.XDG_STATE_HOME ?? resolve(homedir(), ".local", "state"),
    "lervo",
    "repositories.json",
  );
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function ownerOnlyRegistryDirectory(path: string, create: boolean): Promise<void> {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (process.platform !== "win32" && (info.mode & 0o077) !== 0)
  ) {
    fail(
      "repository_registry_path_invalid",
      "The registry directory must be a real owner-only directory.",
    );
  }
}

async function readRegistry(path: string): Promise<RepositoryRegistry> {
  if (!isAbsolute(path) || /[\0\r\n]/u.test(path))
    fail("repository_registry_path_invalid", "The registry must use a safe absolute path.");
  try {
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > maximumRegistryBytes ||
      (process.platform !== "win32" && (info.mode & 0o077) !== 0)
    ) {
      fail("repository_registry_invalid", "The registry file is unsafe.");
    }
    return validateRepositoryRegistry(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT")
      return { schemaVersion: 1, kind: "lervo_repository_registry", repositories: [] };
    if (error instanceof RepositoryRegistryError) throw error;
    throw new RepositoryRegistryError(
      "repository_registry_invalid",
      "The registry file could not be read.",
      { cause: error },
    );
  }
}

async function repositoryRegistration(root: string, now: Date): Promise<RepositoryRegistration> {
  if (!isAbsolute(root) || /[\0\r\n]/u.test(root))
    fail("repository_root_invalid", "The repository to register must use a safe absolute path.");
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    fail(
      "repository_root_invalid",
      "The repository to register must be a real directory, not a symbolic link.",
    );
  }
  const canonicalRoot = await realpath(root);
  const manifest = await loadProjectManifest(canonicalRoot).catch((error: unknown) => {
    throw new RepositoryRegistryError(
      "repository_manifest_invalid",
      "The repository's Lervo project manifest could not be verified.",
      { cause: error },
    );
  });
  const manifestPath = resolveProjectPaths(canonicalRoot).projectManifest;
  const manifestInfo = await lstat(manifestPath);
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > 256 * 1024) {
    fail("repository_manifest_invalid", "The repository's Lervo project manifest is unsafe.");
  }
  return {
    projectId: manifest.projectId,
    name: manifest.name,
    repositoryRoot: canonicalRoot,
    manifestSha256: sha256(await readFile(manifestPath)),
    registeredAt: now.toISOString(),
  };
}

async function writeRegistry(
  path: string,
  registry: RepositoryRegistry,
  expected: RepositoryRegistry,
): Promise<void> {
  const directory = dirname(path);
  await ownerOnlyRegistryDirectory(directory, true);
  const lockPath = resolve(directory, `${basename(path)}.lock`);
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST")
      fail("repository_registry_busy", "Another registry update is in progress.");
    throw error;
  }
  const temporary = resolve(directory, `.${basename(path)}.${process.pid}.tmp`);
  try {
    const current = await readRegistry(path);
    if (JSON.stringify(current) !== JSON.stringify(expected)) {
      fail(
        "repository_registry_changed",
        "The registry changed; register again from a new snapshot.",
      );
    }
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(registry, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

export async function listRegisteredRepositories(
  registryPath: string,
): Promise<RepositoryRegistration[]> {
  return [...(await readRegistry(absoluteRegistryPath(registryPath))).repositories];
}

export async function registerRepository(input: {
  registryPath: string;
  repositoryRoot: string;
  now?: Date;
}): Promise<RegisterRepositoryResult> {
  const registryPath = absoluteRegistryPath(input.registryPath);
  const candidate = await repositoryRegistration(input.repositoryRoot, input.now ?? new Date());
  const registry = await readRegistry(registryPath);
  const sameProject = registry.repositories.find(
    (entry) => entry.projectId === candidate.projectId,
  );
  const sameRoot = registry.repositories.find(
    (entry) => entry.repositoryRoot === candidate.repositoryRoot,
  );
  if (sameProject !== undefined && sameProject.repositoryRoot !== candidate.repositoryRoot)
    fail(
      "repository_project_conflict",
      "The same project ID is already registered at a different root.",
    );
  if (sameRoot !== undefined && sameRoot.projectId !== candidate.projectId)
    fail(
      "repository_root_conflict",
      "The same root is already registered with a different project ID.",
    );
  if (
    sameProject !== undefined &&
    sameProject.manifestSha256 === candidate.manifestSha256 &&
    sameProject.name === candidate.name
  ) {
    return { change: "unchanged", registration: sameProject };
  }
  const change = sameProject === undefined ? "registered" : "refreshed";
  const repositories = registry.repositories.filter(
    (entry) => entry.projectId !== candidate.projectId,
  );
  repositories.push(candidate);
  repositories.sort((left, right) =>
    left.projectId < right.projectId ? -1 : left.projectId > right.projectId ? 1 : 0,
  );
  if (repositories.length > maximumRepositories)
    fail(
      "repository_registry_limit_exceeded",
      "The repository registration limit has been exceeded.",
    );
  await writeRegistry(
    registryPath,
    validateRepositoryRegistry({
      schemaVersion: 1,
      kind: "lervo_repository_registry",
      repositories,
    }),
    registry,
  );
  return { change, registration: candidate };
}

export async function resolveRegisteredRepository(input: {
  registryPath: string;
  projectId: string;
}): Promise<RepositoryRegistration> {
  if (!projectIdPattern.test(input.projectId))
    fail("repository_project_invalid", "The project ID is invalid.");
  const registry = await readRegistry(absoluteRegistryPath(input.registryPath));
  const registration = registry.repositories.find((entry) => entry.projectId === input.projectId);
  if (registration === undefined)
    fail("repository_not_registered", "The selected project is not registered on this device.");
  let current: RepositoryRegistration;
  try {
    current = await repositoryRegistration(
      registration.repositoryRoot,
      new Date(registration.registeredAt),
    );
  } catch (error) {
    throw new RepositoryRegistryError(
      "repository_unavailable",
      "The registered repository cannot currently be verified safely.",
      { cause: error },
    );
  }
  if (
    current.projectId !== registration.projectId ||
    current.name !== registration.name ||
    current.manifestSha256 !== registration.manifestSha256
  ) {
    fail(
      "repository_registration_stale",
      "The project manifest changed after registration and must be registered again.",
    );
  }
  await access(current.repositoryRoot, constants.R_OK | constants.X_OK);
  return registration;
}
