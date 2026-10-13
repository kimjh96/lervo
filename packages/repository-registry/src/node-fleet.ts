import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";

import { loadProjectManifest, resolveProjectPaths } from "@lervo/project";
import { calculateProjectIdentityHash } from "@lervo/sync-contract";

import { defaultRepositoryRegistryPath, RepositoryRegistryError } from "./registry.js";
import type {
  NodeFleetInstanceRegistration,
  NodeFleetOnboardingAction,
  NodeFleetOnboardingPlan,
  NodeFleetRegistry,
  NodeFleetRegistryReconciliation,
  NodeFleetServiceManager,
  RegisterNodeFleetInstanceResult,
} from "./types.js";

const maximumRegistryBytes = 1024 * 1024;
const maximumInstances = 256;
const projectIdPattern = /^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const nodeIdPattern = /^node_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const destinationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const instanceIdPattern = /^nfi_[a-f0-9]{24}$/u;
const runtimeVersionPattern =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const healthFileName = "node-runtime-health.json";
const maximumServiceDefinitionBytes = 128 * 1024;

function fail(code: string, message: string): never {
  throw new RepositoryRegistryError(code, message);
}

function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  );
}

function safeAbsolutePath(value: unknown): value is string {
  return typeof value === "string" && isAbsolute(value) && !/[\0\r\n]/u.test(value);
}

function validTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" && timestampPattern.test(value) && Number.isFinite(Date.parse(value))
  );
}

export function calculateNodeFleetServiceInstanceId(input: {
  projectId: string;
  repositoryIdentityHash: string;
  nodeId: string;
}): string {
  if (
    !projectIdPattern.test(input.projectId) ||
    !digestPattern.test(input.repositoryIdentityHash) ||
    !nodeIdPattern.test(input.nodeId)
  )
    fail("node_fleet_identity_invalid", "The project, repository, or node identity is invalid.");
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: 1,
        projectId: input.projectId,
        repositoryIdentityHash: input.repositoryIdentityHash,
        nodeId: input.nodeId,
      }),
    )
    .digest("hex");
  return `nfi_${digest.slice(0, 24)}`;
}

export function nodeFleetServiceIdentity(
  manager: NodeFleetServiceManager,
  serviceInstanceId: string,
): string {
  if (
    (manager !== "systemd" && manager !== "launchd") ||
    !instanceIdPattern.test(serviceInstanceId)
  ) {
    fail("node_fleet_identity_invalid", "The service manager or instance identity is invalid.");
  }
  const suffix = serviceInstanceId.slice(4);
  return manager === "systemd" ? `lervo-node-${suffix}.service` : `com.lervo.node.${suffix}`;
}

function validInstance(value: unknown): value is NodeFleetInstanceRegistration {
  if (
    !exactKeys(value, [
      "serviceInstanceId",
      "projectId",
      "repositoryIdentityHash",
      "repositoryRoot",
      "nodeId",
      "destinationId",
      "runtimeVersion",
      "serviceManager",
      "serviceIdentity",
      "healthPath",
      "registeredAt",
      "updatedAt",
    ])
  )
    return false;
  if (
    typeof value.serviceInstanceId !== "string" ||
    !instanceIdPattern.test(value.serviceInstanceId) ||
    typeof value.projectId !== "string" ||
    !projectIdPattern.test(value.projectId) ||
    typeof value.repositoryIdentityHash !== "string" ||
    !digestPattern.test(value.repositoryIdentityHash) ||
    !safeAbsolutePath(value.repositoryRoot) ||
    typeof value.nodeId !== "string" ||
    !nodeIdPattern.test(value.nodeId) ||
    typeof value.destinationId !== "string" ||
    !destinationIdPattern.test(value.destinationId) ||
    typeof value.runtimeVersion !== "string" ||
    !runtimeVersionPattern.test(value.runtimeVersion) ||
    (value.serviceManager !== "systemd" && value.serviceManager !== "launchd") ||
    typeof value.serviceIdentity !== "string" ||
    !safeAbsolutePath(value.healthPath) ||
    !validTimestamp(value.registeredAt) ||
    !validTimestamp(value.updatedAt)
  )
    return false;
  const instance = value as unknown as NodeFleetInstanceRegistration;
  try {
    return (
      instance.serviceInstanceId === calculateNodeFleetServiceInstanceId(instance) &&
      instance.serviceIdentity ===
        nodeFleetServiceIdentity(instance.serviceManager, instance.serviceInstanceId) &&
      instance.healthPath ===
        resolve(resolveProjectPaths(instance.repositoryRoot).state, healthFileName)
    );
  } catch {
    return false;
  }
}

export function validateNodeFleetRegistry(value: unknown): NodeFleetRegistry {
  if (
    !exactKeys(value, ["schemaVersion", "kind", "instances"]) ||
    value.schemaVersion !== 1 ||
    value.kind !== "lervo_node_fleet_registry" ||
    !Array.isArray(value.instances) ||
    value.instances.length > maximumInstances ||
    !value.instances.every(validInstance)
  )
    fail("node_fleet_registry_invalid", "The Node fleet registry structure is invalid.");
  const instances = value.instances as NodeFleetInstanceRegistration[];
  for (let index = 0; index < instances.length; index += 1) {
    const current = instances[index]!;
    const previous = instances[index - 1];
    if (previous !== undefined && previous.projectId >= current.projectId) {
      fail(
        "node_fleet_registry_invalid",
        "The Node fleet registry is unsorted or contains duplicate project IDs.",
      );
    }
    if (
      instances.some(
        (entry, other) =>
          other !== index &&
          (entry.repositoryRoot === current.repositoryRoot ||
            entry.nodeId === current.nodeId ||
            entry.serviceInstanceId === current.serviceInstanceId ||
            entry.serviceIdentity === current.serviceIdentity ||
            entry.healthPath === current.healthPath),
      )
    )
      fail(
        "node_fleet_registry_invalid",
        "The Node fleet registry contains conflicting instance coordinates.",
      );
  }
  return value as unknown as NodeFleetRegistry;
}

export function defaultNodeFleetRegistryPath(environment: NodeJS.ProcessEnv = process.env): string {
  return resolve(dirname(defaultRepositoryRegistryPath(environment)), "node-fleet.json");
}

/** The host repository registry that sits beside a Node fleet registry. */
export function repositoryRegistryPathBesideNodeFleet(nodeFleetRegistryPath: string): string {
  return resolve(dirname(absoluteRegistryPath(nodeFleetRegistryPath)), "repositories.json");
}

function absoluteRegistryPath(path: string): string {
  if (!safeAbsolutePath(path))
    fail(
      "node_fleet_registry_path_invalid",
      "The Node fleet registry must use a safe absolute path.",
    );
  return resolve(path);
}

async function ownerOnlyDirectory(path: string, create: boolean): Promise<void> {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (process.platform !== "win32" && (info.mode & 0o077) !== 0)
  ) {
    fail(
      "node_fleet_registry_path_invalid",
      "The Node fleet registry directory must be real and owner-only.",
    );
  }
}

async function readRegistry(path: string): Promise<NodeFleetRegistry> {
  try {
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > maximumRegistryBytes ||
      (process.platform !== "win32" && (info.mode & 0o077) !== 0)
    ) {
      fail("node_fleet_registry_invalid", "The Node fleet registry file is unsafe.");
    }
    return validateNodeFleetRegistry(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { schemaVersion: 1, kind: "lervo_node_fleet_registry", instances: [] };
    }
    if (error instanceof RepositoryRegistryError) throw error;
    throw new RepositoryRegistryError(
      "node_fleet_registry_invalid",
      "The Node fleet registry file could not be read.",
      { cause: error },
    );
  }
}

async function writeRegistry(
  path: string,
  registry: NodeFleetRegistry,
  expected: NodeFleetRegistry,
): Promise<void> {
  const directory = dirname(path);
  await ownerOnlyDirectory(directory, true);
  const lockPath = resolve(directory, `${basename(path)}.lock`);
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
      fail("node_fleet_registry_busy", "Another Node fleet registry update is in progress.");
    }
    throw error;
  }
  const temporary = resolve(directory, `.${basename(path)}.${process.pid}.tmp`);
  try {
    const current = await readRegistry(path);
    if (JSON.stringify(current) !== JSON.stringify(expected)) {
      fail(
        "node_fleet_registry_changed",
        "The Node fleet registry changed; reconcile again from a new snapshot.",
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

async function desiredInstance(input: {
  repositoryRoot: string;
  nodeId: string;
  destinationId: string;
  runtimeVersion: string;
  serviceManager: NodeFleetServiceManager;
}): Promise<Omit<NodeFleetInstanceRegistration, "registeredAt" | "updatedAt">> {
  if (!safeAbsolutePath(input.repositoryRoot)) {
    fail(
      "node_fleet_repository_invalid",
      "The Node fleet repository root must use a safe absolute path.",
    );
  }
  const rootInfo = await lstat(input.repositoryRoot).catch((error: unknown) => {
    throw new RepositoryRegistryError(
      "node_fleet_repository_invalid",
      "The Node fleet repository root could not be verified.",
      { cause: error },
    );
  });
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    fail(
      "node_fleet_repository_invalid",
      "The Node fleet repository root must be a real directory.",
    );
  }
  if (
    !nodeIdPattern.test(input.nodeId) ||
    !destinationIdPattern.test(input.destinationId) ||
    !runtimeVersionPattern.test(input.runtimeVersion) ||
    (input.serviceManager !== "systemd" && input.serviceManager !== "launchd")
  ) {
    fail(
      "node_fleet_coordinates_invalid",
      "The Node, destination, runtime, or service-manager coordinate is invalid.",
    );
  }
  const repositoryRoot = await realpath(input.repositoryRoot);
  const manifest = await loadProjectManifest(repositoryRoot).catch((error: unknown) => {
    throw new RepositoryRegistryError(
      "node_fleet_manifest_invalid",
      "The Node fleet project manifest could not be verified.",
      { cause: error },
    );
  });
  if (!manifest.dataPolicy.hubSyncEnabled) {
    fail(
      "node_fleet_sync_disabled",
      "The project data policy does not enable Hub synchronization.",
    );
  }
  const repositoryIdentityHash = calculateProjectIdentityHash(manifest);
  const serviceInstanceId = calculateNodeFleetServiceInstanceId({
    projectId: manifest.projectId,
    repositoryIdentityHash,
    nodeId: input.nodeId,
  });
  return {
    serviceInstanceId,
    projectId: manifest.projectId,
    repositoryIdentityHash,
    repositoryRoot,
    nodeId: input.nodeId,
    destinationId: input.destinationId,
    runtimeVersion: input.runtimeVersion,
    serviceManager: input.serviceManager,
    serviceIdentity: nodeFleetServiceIdentity(input.serviceManager, serviceInstanceId),
    healthPath: resolve(resolveProjectPaths(repositoryRoot).state, healthFileName),
  };
}

async function candidate(input: {
  repositoryRoot: string;
  nodeId: string;
  destinationId: string;
  runtimeVersion: string;
  serviceManager: NodeFleetServiceManager;
  now: Date;
}): Promise<NodeFleetInstanceRegistration> {
  const desired = await desiredInstance(input);
  const timestamp = input.now.toISOString();
  return { ...desired, registeredAt: timestamp, updatedAt: timestamp };
}

/** The canonical user service definition path for one Node service identity. */
export function nodeFleetServiceTargetPath(
  homeDirectory: string,
  manager: NodeFleetServiceManager,
  serviceIdentity: string,
): string {
  if (!safeAbsolutePath(homeDirectory)) {
    fail("node_fleet_home_invalid", "The service home directory must use a safe absolute path.");
  }
  return manager === "systemd"
    ? resolve(homeDirectory, ".config", "systemd", "user", serviceIdentity)
    : resolve(homeDirectory, "Library", "LaunchAgents", `${serviceIdentity}.plist`);
}

async function serviceFileState(
  path: string,
): Promise<{ state: "absent" | "present_unverified" | "conflict"; contentHash: string | null }> {
  try {
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size < 1 ||
      info.size > maximumServiceDefinitionBytes ||
      (process.platform !== "win32" && (info.mode & 0o077) !== 0)
    )
      return { state: "conflict", contentHash: null };
    return {
      state: "present_unverified",
      contentHash: `sha256:${createHash("sha256")
        .update(await readFile(path))
        .digest("hex")}`,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { state: "absent", contentHash: null };
    return { state: "conflict", contentHash: null };
  }
}

function sameDesired(
  current: NodeFleetInstanceRegistration,
  desired: Omit<NodeFleetInstanceRegistration, "registeredAt" | "updatedAt">,
): boolean {
  const { registeredAt: _registeredAt, updatedAt: _updatedAt, ...coordinates } = current;
  return JSON.stringify(coordinates) === JSON.stringify(desired);
}

function planIdentifier(value: unknown): string {
  const digest = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return `nfp_${digest.slice(0, 24)}`;
}

export async function createNodeFleetOnboardingPlan(input: {
  registryPath: string;
  repositoryRoot: string;
  nodeId: string;
  destinationId: string;
  runtimeVersion: string;
  serviceManager: NodeFleetServiceManager;
  homeDirectory?: string;
}): Promise<NodeFleetOnboardingPlan> {
  const registryPath = absoluteRegistryPath(input.registryPath);
  const desired = await desiredInstance(input);
  const registry = await readRegistry(registryPath);
  const current = registry.instances.find((entry) => entry.projectId === desired.projectId) ?? null;
  const rootConflict = registry.instances.find(
    (entry) =>
      entry.repositoryRoot === desired.repositoryRoot && entry.projectId !== desired.projectId,
  );
  const nodeConflict = registry.instances.find(
    (entry) => entry.nodeId === desired.nodeId && entry.projectId !== desired.projectId,
  );
  if (rootConflict !== undefined) {
    fail(
      "node_fleet_root_conflict",
      "The repository root already belongs to a different Node fleet project.",
    );
  }
  if (nodeConflict !== undefined) {
    fail("node_fleet_node_conflict", "The Node identity already belongs to a different project.");
  }
  if (
    current !== null &&
    (current.repositoryRoot !== desired.repositoryRoot || current.nodeId !== desired.nodeId)
  )
    fail(
      "node_fleet_project_conflict",
      "The project already has a different Node fleet identity or root.",
    );

  const reconciliation: NodeFleetRegistryReconciliation =
    current === null ? "register" : sameDesired(current, desired) ? "unchanged" : "refresh";
  const homeDirectory = input.homeDirectory ?? homedir();
  const targetPath = nodeFleetServiceTargetPath(
    homeDirectory,
    desired.serviceManager,
    desired.serviceIdentity,
  );
  const legacyIdentity =
    desired.serviceManager === "systemd" ? "lervo-node.service" : "com.lervo.node.plist";
  const legacyTargetPath =
    desired.serviceManager === "systemd"
      ? resolve(homeDirectory, ".config", "systemd", "user", legacyIdentity)
      : resolve(homeDirectory, "Library", "LaunchAgents", legacyIdentity);
  const [targetObservation, legacyTargetObservation] = await Promise.all([
    serviceFileState(targetPath),
    serviceFileState(legacyTargetPath),
  ]);
  const targetState = targetObservation.state;
  const legacyTargetState = legacyTargetObservation.state;
  const actions: NodeFleetOnboardingAction[] = [
    {
      code: reconciliation === "refresh" ? "refresh_fleet_instance" : "register_fleet_instance",
      state: reconciliation === "unchanged" ? "not_required" : "required",
      authority: "local_state_write",
      failureMeaning:
        "The desired repository-node coordinates are not recorded in the local fleet registry.",
    },
    {
      code: targetState === "conflict" ? "review_service_conflict" : "install_repository_service",
      state: targetState === "absent" || targetState === "conflict" ? "required" : "not_required",
      authority: "service_installation",
      failureMeaning:
        targetState === "conflict"
          ? "The expected service target is unsafe or cannot be verified and must not be overwritten."
          : "The expected service definition is absent; presence alone would not prove activation.",
    },
    {
      code: "review_legacy_singleton",
      state: legacyTargetState === "absent" ? "not_required" : "required",
      authority: "service_transition",
      failureMeaning:
        "A legacy singleton service remains separate and must not be stopped, replaced, or removed automatically.",
    },
    {
      code: "issue_scoped_credentials",
      state: "unobserved",
      authority: "external_registration",
      failureMeaning: "The local plan cannot prove Hub registration or credential authority.",
    },
    {
      code: "observe_runtime_readiness",
      state: "unobserved",
      authority: "runtime_observation",
      failureMeaning:
        "Installation or activation does not prove the required stable readiness observations.",
    },
  ];
  const planBody = {
    schemaVersion: 1 as const,
    planKind: "repository_node_onboarding" as const,
    outcome:
      reconciliation !== "unchanged" ||
      targetState !== "present_unverified" ||
      legacyTargetState !== "absent"
        ? ("reconcile_required" as const)
        : ("observation_required" as const),
    verification: "manifest_revalidated" as const,
    desired,
    registry: { path: registryPath, reconciliation, current },
    service: {
      targetPath,
      targetState,
      targetContentHash: targetObservation.contentHash,
      legacyTargetPath,
      legacyTargetState,
      legacyTargetContentHash: legacyTargetObservation.contentHash,
      activation: "not_observed" as const,
      readiness: "not_observed" as const,
    },
    actions,
    privacy: {
      scope: "local_plan_only" as const,
      absolutePaths: "local_output_only" as const,
      credentials: "excluded" as const,
      serviceDefinitionBodies: "excluded" as const,
    },
    staleIf: [
      "project_manifest_changes",
      "fleet_registry_changes",
      "service_target_changes",
      "legacy_service_target_changes",
      "desired_coordinates_change",
    ] as const,
  };
  return { ...planBody, planId: planIdentifier(planBody) };
}

export async function listNodeFleetInstances(
  registryPath: string,
): Promise<NodeFleetInstanceRegistration[]> {
  return [...(await readRegistry(absoluteRegistryPath(registryPath))).instances];
}

export async function registerNodeFleetInstance(input: {
  registryPath: string;
  repositoryRoot: string;
  nodeId: string;
  destinationId: string;
  runtimeVersion: string;
  serviceManager: NodeFleetServiceManager;
  now?: Date;
}): Promise<RegisterNodeFleetInstanceResult> {
  const registryPath = absoluteRegistryPath(input.registryPath);
  const next = await candidate({ ...input, now: input.now ?? new Date() });
  const registry = await readRegistry(registryPath);
  const sameProject = registry.instances.find((entry) => entry.projectId === next.projectId);
  const sameRoot = registry.instances.find((entry) => entry.repositoryRoot === next.repositoryRoot);
  const sameNode = registry.instances.find((entry) => entry.nodeId === next.nodeId);
  if (
    sameProject !== undefined &&
    (sameProject.repositoryRoot !== next.repositoryRoot || sameProject.nodeId !== next.nodeId)
  )
    fail(
      "node_fleet_project_conflict",
      "The project already has a different Node fleet identity or root.",
    );
  if (sameRoot !== undefined && sameRoot.projectId !== next.projectId) {
    fail(
      "node_fleet_root_conflict",
      "The repository root already belongs to a different Node fleet project.",
    );
  }
  if (sameNode !== undefined && sameNode.projectId !== next.projectId) {
    fail("node_fleet_node_conflict", "The Node identity already belongs to a different project.");
  }
  if (sameProject !== undefined) {
    const comparableCurrent = {
      ...sameProject,
      registeredAt: next.registeredAt,
      updatedAt: next.updatedAt,
    };
    if (JSON.stringify(comparableCurrent) === JSON.stringify(next)) {
      return { change: "unchanged", registration: sameProject };
    }
    next.registeredAt = sameProject.registeredAt;
  }
  const instances = registry.instances.filter((entry) => entry.projectId !== next.projectId);
  instances.push(next);
  instances.sort((left, right) =>
    left.projectId < right.projectId ? -1 : left.projectId > right.projectId ? 1 : 0,
  );
  if (instances.length > maximumInstances) {
    fail("node_fleet_registry_limit_exceeded", "The Node fleet instance limit has been exceeded.");
  }
  const updated = validateNodeFleetRegistry({
    schemaVersion: 1,
    kind: "lervo_node_fleet_registry",
    instances,
  });
  await writeRegistry(registryPath, updated, registry);
  return { change: sameProject === undefined ? "registered" : "refreshed", registration: next };
}
