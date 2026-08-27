import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadNodeRuntimeConfig, type NodeRuntimeHealthSnapshot } from "@lervo/node-runtime";
import {
  createNodeFleetOnboardingPlan,
  listNodeFleetInstances,
  registerNodeFleetInstance,
  type NodeFleetOnboardingPlan,
  type NodeFleetServiceManager,
  type RegisterNodeFleetInstanceResult,
} from "@lervo/repository-registry";

// These release-tested service primitives are bundled into the installed CLI.
// @ts-expect-error The repository service script intentionally remains plain ESM.
import { manageRuntimeService } from "../../../scripts/manage-runtime-service.mjs";
// @ts-expect-error The repository service script intentionally remains plain ESM.
import { createRuntimeServiceDefinition } from "../../../scripts/render-runtime-service.mjs";

const READY_OBSERVATIONS = 3;
const READY_INTERVAL_MS = 500;
const READY_MAXIMUM_OBSERVATIONS = 120;
const MAXIMUM_HEALTH_BYTES = 64 * 1024;

export class NodeFleetApplyError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NodeFleetApplyError";
    this.code = code;
  }
}

type ServiceResult = {
  change: "installed" | "activated" | "upgraded" | "rolled_back" | "unchanged" | "removed";
  managerAvailable: boolean;
  installed: boolean;
  active: boolean;
  enabled: boolean | null;
  serviceIdentity: string;
};

export interface NodeFleetApplyPorts {
  executablePath?: string;
  serviceOptions?: {
    platform?: NodeJS.Platform;
    homeDirectory?: string;
    uid?: number;
    runCommand?: (command: string, args: string[]) => Promise<{ exitCode: number | null }>;
    wait?: (durationMs: number) => Promise<void>;
  };
  wait?: (durationMs: number) => Promise<void>;
  readHealth?: (path: string) => Promise<NodeRuntimeHealthSnapshot>;
}

export interface NodeFleetApplyReceipt {
  schemaVersion: 1;
  operation: "repository_node_onboarding";
  planId: string;
  service: ServiceResult;
  readiness: {
    status: "ready" | "offline_ready";
    observations: 3;
    processId: number;
    startedAt: string;
    sync: "ready" | "unavailable:hub_unavailable";
    workstreamReplication: "ready" | "unavailable:hub_unavailable";
    workspaceCoordination: "ready" | "disabled" | "unavailable:hub_unavailable";
    remoteControl: "ready" | "disabled" | "unavailable:hub_unavailable";
  };
  registry: RegisterNodeFleetInstanceResult;
}

export interface NodeFleetStatusReport {
  schemaVersion: 1;
  status: "ready" | "degraded";
  instances: Array<{
    projectId: string;
    serviceInstanceId: string;
    repositoryRoot: string;
    destinationId: string;
    runtimeVersion: string;
    service: {
      managerAvailable: boolean;
      installed: boolean;
      active: boolean;
      enabled: boolean | null;
    };
    runtime: {
      status: "ready" | "starting" | "degraded" | "stopping" | "unavailable" | "stale";
      sync: string;
      workstreamReplication: string;
      workspaceCoordination: string;
      remoteControl: string;
      updatedAt: string | null;
    };
    recoveryAction: "none" | "reapply_exact_plan" | "inspect_runtime_failure" | "wait_for_runtime";
  }>;
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new NodeFleetApplyError(code, message, cause === undefined ? undefined : { cause });
}

function safeAbsolute(value: string): boolean {
  return resolve(value) === value && !/[\0\r\n]/u.test(value);
}

function defaultExecutablePath(): string {
  return fileURLToPath(new URL("./node-runtime.js", import.meta.url));
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function materializeInstalledNodeLauncher(homeDirectory?: string): Promise<string> {
  const source = defaultExecutablePath();
  const sourceInfo = await lstat(source).catch((error: unknown) =>
    fail(
      "node_fleet_executable_invalid",
      "The installed Node runtime payload is unavailable.",
      error,
    ),
  );
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink() || sourceInfo.size < 1)
    fail("node_fleet_executable_invalid", "The installed Node runtime payload is unsafe.");
  const bytes = await readFile(source);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const home = resolve(homeDirectory ?? homedir());
  const directory =
    process.platform === "darwin"
      ? resolve(
          home,
          "Library",
          "Application Support",
          "Lervo",
          "runtimes",
          "node",
          hash.slice(0, 16),
        )
      : resolve(home, ".local", "share", "lervo", "runtimes", "node", hash.slice(0, 16));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const payload = resolve(directory, "node-runtime.js");
  const launcher = resolve(directory, `lervo-node-launcher-${hash.slice(0, 12)}`);
  const launcherContent = `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(payload)} "$@"\n`;
  for (const [path, content, mode] of [
    [payload, bytes, 0o600],
    [launcher, launcherContent, 0o700],
  ] as const) {
    try {
      await writeFile(path, content, { flag: "wx", mode });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readFile(path);
      const expected = typeof content === "string" ? Buffer.from(content) : content;
      if (!existing.equals(expected))
        fail(
          "node_fleet_executable_invalid",
          "An installed runtime payload path contains different bytes.",
        );
    }
    await chmod(path, mode);
  }
  return assertNodeFleetExecutable(launcher);
}

export async function assertNodeFleetExecutable(path: string): Promise<string> {
  if (!safeAbsolute(path))
    fail("node_fleet_executable_invalid", "The installed Node runtime path is invalid.");
  const metadata = await lstat(path).catch((error: unknown) =>
    fail("node_fleet_executable_invalid", "The installed Node runtime is unavailable.", error),
  );
  if (!metadata.isFile() || metadata.isSymbolicLink())
    fail(
      "node_fleet_executable_invalid",
      "The installed Node runtime must be a real regular file.",
    );
  await access(path, constants.X_OK).catch((error: unknown) =>
    fail("node_fleet_executable_invalid", "The installed Node runtime is not executable.", error),
  );
  return realpath(path);
}

function healthComponent(value: unknown): value is NodeRuntimeHealthSnapshot["sync"] {
  if (value === null || typeof value !== "object") return false;
  const component = value as { status?: unknown; failureCode?: unknown };
  if (["pending", "ready", "disabled"].includes(component.status as string)) {
    return component.failureCode === undefined;
  }
  return (
    component.status === "unavailable" &&
    typeof component.failureCode === "string" &&
    component.failureCode.length > 0 &&
    component.failureCode.length <= 128 &&
    !/[\0\r\n]/u.test(component.failureCode)
  );
}

async function readHealthSnapshot(path: string): Promise<NodeRuntimeHealthSnapshot> {
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > MAXIMUM_HEALTH_BYTES ||
    (process.platform !== "win32" && (metadata.mode & 0o077) !== 0)
  )
    fail("node_fleet_readiness_invalid", "The Node runtime health snapshot is unsafe.");
  const value = JSON.parse(await readFile(path, "utf8")) as NodeRuntimeHealthSnapshot;
  if (
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.processId) ||
    value.processId < 1 ||
    !Number.isFinite(Date.parse(value.startedAt)) ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    !healthComponent(value.sync) ||
    !healthComponent(value.workstreamReplication) ||
    !healthComponent(value.workspaceCoordination) ||
    !healthComponent(value.remoteControl) ||
    !["starting", "ready", "degraded", "stopping"].includes(value.status)
  ) {
    fail("node_fleet_readiness_unavailable", "The Node runtime health snapshot is invalid.");
  }
  return value;
}

async function readReportedHealth(path: string): Promise<NodeRuntimeHealthSnapshot | null> {
  try {
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size < 1 ||
      metadata.size > MAXIMUM_HEALTH_BYTES ||
      (process.platform !== "win32" && (metadata.mode & 0o077) !== 0)
    )
      return null;
    const value = JSON.parse(await readFile(path, "utf8")) as NodeRuntimeHealthSnapshot;
    return value.schemaVersion === 1 &&
      Number.isSafeInteger(value.processId) &&
      Number.isFinite(Date.parse(value.updatedAt))
      ? value
      : null;
  } catch {
    return null;
  }
}

function componentStatus(value: { status: string; failureCode?: string } | undefined): string {
  return value === undefined
    ? "unavailable"
    : value.status === "unavailable"
      ? `unavailable:${value.failureCode ?? "unknown"}`
      : value.status;
}

export async function inspectNodeFleetStatus(input: {
  registryPath: string;
  homeDirectory?: string;
  ports?: Pick<NodeFleetApplyPorts, "serviceOptions">;
  now?: Date;
}): Promise<NodeFleetStatusReport> {
  const registrations = await listNodeFleetInstances(input.registryPath);
  const now = input.now ?? new Date();
  const instances = await Promise.all(
    registrations.map(async (registration) => {
      const service = (await manageRuntimeService(
        [
          "--action",
          "status",
          "--manager",
          registration.serviceManager,
          "--runtime",
          "node",
          "--instance",
          registration.serviceInstanceId,
        ],
        {
          ...input.ports?.serviceOptions,
          ...(input.homeDirectory === undefined ? {} : { homeDirectory: input.homeDirectory }),
        },
      )) as ServiceResult;
      const health = await readReportedHealth(registration.healthPath);
      const operational =
        service.managerAvailable &&
        service.installed &&
        service.active &&
        service.enabled !== false;
      const stale = health !== null && now.getTime() - Date.parse(health.updatedAt) > 2 * 60_000;
      const runtimeStatus =
        health === null ? ("unavailable" as const) : stale ? ("stale" as const) : health.status;
      const ready = operational && runtimeStatus === "ready";
      return {
        projectId: registration.projectId,
        serviceInstanceId: registration.serviceInstanceId,
        repositoryRoot: registration.repositoryRoot,
        destinationId: registration.destinationId,
        runtimeVersion: registration.runtimeVersion,
        service: {
          managerAvailable: service.managerAvailable,
          installed: service.installed,
          active: service.active,
          enabled: service.enabled,
        },
        runtime: {
          status: runtimeStatus,
          sync: componentStatus(health?.sync),
          workstreamReplication: componentStatus(health?.workstreamReplication),
          workspaceCoordination: componentStatus(health?.workspaceCoordination),
          remoteControl: componentStatus(health?.remoteControl),
          updatedAt: health?.updatedAt ?? null,
        },
        recoveryAction: ready
          ? ("none" as const)
          : !operational
            ? ("reapply_exact_plan" as const)
            : runtimeStatus === "starting"
              ? ("wait_for_runtime" as const)
              : ("inspect_runtime_failure" as const),
      };
    }),
  );
  return {
    schemaVersion: 1,
    status: instances.every((item) => item.recoveryAction === "none") ? "ready" : "degraded",
    instances,
  };
}

export async function observeNodeFleetReadiness(
  path: string,
  notBefore: Date,
  ports: NodeFleetApplyPorts,
  allowHubUnavailable: boolean,
): Promise<NodeFleetApplyReceipt["readiness"]> {
  const read = ports.readHealth ?? readHealthSnapshot;
  const wait =
    ports.wait ??
    ((durationMs: number) => new Promise<void>((done) => setTimeout(done, durationMs)));
  let consecutive = 0;
  let identity: string | null = null;
  let previousUpdatedAt = 0;
  let last: NodeRuntimeHealthSnapshot | null = null;
  for (let attempt = 0; attempt < READY_MAXIMUM_OBSERVATIONS; attempt += 1) {
    try {
      const current = await read(path);
      const currentIdentity = `${current.processId}\0${current.startedAt}`;
      const updatedAt = Date.parse(current.updatedAt);
      const hubUnavailable = (component: NodeRuntimeHealthSnapshot["sync"]): boolean =>
        component.status === "unavailable" && component.failureCode === "hub_unavailable";
      const syncReady =
        current.sync.status === "ready" || (allowHubUnavailable && hubUnavailable(current.sync));
      const workstreamReady =
        current.workstreamReplication.status === "ready" ||
        (allowHubUnavailable && hubUnavailable(current.workstreamReplication));
      const remoteReady =
        current.remoteControl.status === "ready" ||
        current.remoteControl.status === "disabled" ||
        (allowHubUnavailable && hubUnavailable(current.remoteControl));
      const workspaceReady =
        current.workspaceCoordination.status === "ready" ||
        current.workspaceCoordination.status === "disabled" ||
        (allowHubUnavailable && hubUnavailable(current.workspaceCoordination));
      const offline =
        hubUnavailable(current.sync) ||
        hubUnavailable(current.workstreamReplication) ||
        hubUnavailable(current.workspaceCoordination) ||
        hubUnavailable(current.remoteControl);
      const complete =
        (current.status === "ready" ||
          (allowHubUnavailable && current.status === "degraded" && offline)) &&
        syncReady &&
        workstreamReady &&
        workspaceReady &&
        remoteReady &&
        updatedAt >= notBefore.getTime();
      if (
        complete &&
        (identity === null || identity === currentIdentity) &&
        updatedAt >= previousUpdatedAt
      ) {
        identity = currentIdentity;
        previousUpdatedAt = updatedAt;
        last = current;
        consecutive += 1;
        if (consecutive === READY_OBSERVATIONS) {
          return {
            status: offline ? "offline_ready" : "ready",
            observations: 3,
            processId: current.processId,
            startedAt: current.startedAt,
            sync: componentStatus(current.sync) as NodeFleetApplyReceipt["readiness"]["sync"],
            workstreamReplication: componentStatus(
              current.workstreamReplication,
            ) as NodeFleetApplyReceipt["readiness"]["workstreamReplication"],
            workspaceCoordination: componentStatus(
              current.workspaceCoordination,
            ) as NodeFleetApplyReceipt["readiness"]["workspaceCoordination"],
            remoteControl: componentStatus(
              current.remoteControl,
            ) as NodeFleetApplyReceipt["readiness"]["remoteControl"],
          };
        }
      } else {
        consecutive = 0;
        identity = null;
        previousUpdatedAt = 0;
      }
    } catch {
      consecutive = 0;
      identity = null;
      previousUpdatedAt = 0;
    }
    await wait(READY_INTERVAL_MS);
  }
  fail(
    "node_fleet_readiness_timeout",
    last === null
      ? "The Node runtime did not publish a safe readiness snapshot."
      : "The Node runtime did not remain completely ready for three observations.",
  );
}

function serviceArgs(input: {
  action: "install" | "upgrade" | "rollback" | "remove";
  manager: NodeFleetServiceManager;
  instance: string;
  definition: string;
  executable: string;
  config: string;
  previousDefinition?: string;
}): string[] {
  return [
    "--action",
    input.action,
    "--manager",
    input.manager,
    "--runtime",
    "node",
    "--instance",
    input.instance,
    "--definition",
    input.definition,
    ...(input.previousDefinition === undefined
      ? []
      : ["--previous-definition", input.previousDefinition]),
    "--executable",
    input.executable,
    "--config",
    input.config,
    "--write",
  ];
}

export async function applyNodeFleetOnboarding(input: {
  plan: NodeFleetOnboardingPlan;
  configPath: string;
  homeDirectory?: string;
  ports?: NodeFleetApplyPorts;
  transitionLegacy?: boolean;
  allowHubUnavailableReadiness?: boolean;
}): Promise<NodeFleetApplyReceipt> {
  const ports = input.ports ?? {};
  const planInput = {
    registryPath: input.plan.registry.path,
    repositoryRoot: input.plan.desired.repositoryRoot,
    nodeId: input.plan.desired.nodeId,
    destinationId: input.plan.desired.destinationId,
    runtimeVersion: input.plan.desired.runtimeVersion,
    serviceManager: input.plan.desired.serviceManager,
    ...(input.homeDirectory === undefined ? {} : { homeDirectory: input.homeDirectory }),
  };
  const current = await createNodeFleetOnboardingPlan(planInput);
  if (current.planId !== input.plan.planId)
    fail("node_fleet_plan_stale", "The Node fleet plan changed before apply.");
  if (current.service.targetState === "conflict")
    fail("node_fleet_service_conflict", "The repository service target is unsafe or conflicting.");
  if (current.service.legacyTargetState !== "absent" && !input.transitionLegacy)
    fail(
      "node_fleet_legacy_transition_required",
      "A legacy singleton service requires explicit transition authority.",
    );
  if (input.transitionLegacy && current.service.legacyTargetState !== "present_unverified")
    fail(
      "node_fleet_legacy_transition_required",
      "The legacy singleton is absent or unsafe and cannot be transitioned.",
    );

  const configPath = resolve(input.configPath);
  if (!safeAbsolute(configPath))
    fail("node_fleet_config_invalid", "The Node runtime config path must be absolute and safe.");
  const config = await loadNodeRuntimeConfig(configPath).catch((error: unknown) =>
    fail("node_fleet_config_invalid", "The Node runtime config could not be verified.", error),
  );
  const configRoot = await realpath(config.repositoryRoot).catch((error: unknown) =>
    fail(
      "node_fleet_config_invalid",
      "The configured repository root could not be verified.",
      error,
    ),
  );
  if (
    configRoot !== current.desired.repositoryRoot ||
    config.hub.destinationId !== current.desired.destinationId ||
    (config.remoteCommands !== undefined && config.remoteCommands.nodeId !== current.desired.nodeId)
  ) {
    fail(
      "node_fleet_config_mismatch",
      "The runtime config does not match the planned repository, destination, or Node identity.",
    );
  }
  const executable =
    ports.executablePath === undefined
      ? await materializeInstalledNodeLauncher(input.homeDirectory)
      : await assertNodeFleetExecutable(resolve(ports.executablePath));
  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "lervo-node-service-"));
  const definition = resolve(temporaryDirectory, "service-definition");
  const previousDefinition = resolve(temporaryDirectory, "previous-service-definition");
  const appliedAt = new Date();
  let service: ServiceResult | null = null;
  let compensated = false;
  let registryCommitted = false;
  const options = {
    ...ports.serviceOptions,
    ...(input.homeDirectory === undefined ? {} : { homeDirectory: input.homeDirectory }),
  };
  const compensate = async (): Promise<void> => {
    if (compensated || service === null) return;
    compensated = true;
    if (service.change === "installed") {
      await manageRuntimeService(
        serviceArgs({
          action: "remove",
          manager: current.desired.serviceManager,
          instance: current.desired.serviceInstanceId,
          definition,
          executable,
          config: configPath,
        }),
        options,
      );
    } else if (service.change === "upgraded") {
      await manageRuntimeService(
        serviceArgs({
          action: "rollback",
          manager: current.desired.serviceManager,
          instance: current.desired.serviceInstanceId,
          definition,
          previousDefinition,
          executable,
          config: configPath,
        }),
        options,
      );
    }
  };
  try {
    const content = await createRuntimeServiceDefinition({
      manager: current.desired.serviceManager,
      runtime: "node",
      instance: current.desired.serviceInstanceId,
      executable,
      config: configPath,
    });
    await writeFile(definition, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(definition, 0o600);
    const desiredHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    if (
      current.service.targetContentHash !== null &&
      current.service.targetContentHash !== desiredHash
    ) {
      const currentBytes = await readFile(current.service.targetPath);
      const observedHash = `sha256:${createHash("sha256").update(currentBytes).digest("hex")}`;
      if (observedHash !== current.service.targetContentHash)
        fail("node_fleet_plan_stale", "The installed service changed before upgrade.");
      await writeFile(previousDefinition, currentBytes, { mode: 0o600, flag: "wx" });
      await chmod(previousDefinition, 0o600);
      service = (await manageRuntimeService(
        serviceArgs({
          action: "upgrade",
          manager: current.desired.serviceManager,
          instance: current.desired.serviceInstanceId,
          definition,
          previousDefinition,
          executable,
          config: configPath,
        }),
        options,
      )) as ServiceResult;
    } else {
      service = (await manageRuntimeService(
        serviceArgs({
          action: "install",
          manager: current.desired.serviceManager,
          instance: current.desired.serviceInstanceId,
          definition,
          executable,
          config: configPath,
        }),
        options,
      )) as ServiceResult;
    }
    if (
      !service.managerAvailable ||
      !service.installed ||
      !service.active ||
      service.enabled === false
    )
      fail("node_fleet_service_unavailable", "The repository service did not remain active.");
    const readiness = await observeNodeFleetReadiness(
      current.desired.healthPath,
      appliedAt,
      ports,
      input.allowHubUnavailableReadiness === true,
    );
    let registry: RegisterNodeFleetInstanceResult;
    try {
      registry = await registerNodeFleetInstance({
        registryPath: current.registry.path,
        repositoryRoot: current.desired.repositoryRoot,
        nodeId: current.desired.nodeId,
        destinationId: current.desired.destinationId,
        runtimeVersion: current.desired.runtimeVersion,
        serviceManager: current.desired.serviceManager,
      });
      registryCommitted = true;
    } catch (error) {
      await compensate().catch((recoveryError: unknown) =>
        fail(
          "node_fleet_recovery_failed",
          "Fleet registration failed and the prior service state could not be restored.",
          recoveryError,
        ),
      );
      fail(
        "node_fleet_registry_apply_failed",
        "Runtime readiness was observed but fleet registration failed.",
        error,
      );
    }
    if (input.transitionLegacy && current.service.legacyTargetState === "present_unverified") {
      await transitionLegacySingleton({
        manager: current.desired.serviceManager,
        path: current.service.legacyTargetPath,
        contentHash: current.service.legacyTargetContentHash!,
        configPath,
        ...(input.homeDirectory === undefined ? {} : { homeDirectory: input.homeDirectory }),
        ...(ports.serviceOptions === undefined ? {} : { serviceOptions: ports.serviceOptions }),
      });
    }
    return {
      schemaVersion: 1,
      operation: "repository_node_onboarding",
      planId: current.planId,
      service,
      readiness,
      registry,
    };
  } catch (error) {
    if (!registryCommitted)
      await compensate().catch((recoveryError: unknown) =>
        fail(
          "node_fleet_recovery_failed",
          "Node onboarding failed and the prior service state could not be restored.",
          recoveryError,
        ),
      );
    if (error instanceof NodeFleetApplyError) throw error;
    fail("node_fleet_apply_failed", "The repository Node onboarding operation failed.", error);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function transitionLegacySingleton(input: {
  manager: NodeFleetServiceManager;
  path: string;
  contentHash: string;
  configPath: string;
  homeDirectory?: string;
  serviceOptions?: NodeFleetApplyPorts["serviceOptions"];
}): Promise<void> {
  const bytes = await readFile(input.path);
  if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== input.contentHash)
    fail("node_fleet_plan_stale", "The legacy service changed before transition.");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (input.manager === "launchd") {
    if (
      !text.includes("<string>com.lervo.node</string>") ||
      !text.includes("<string>--config</string>") ||
      !text.includes(
        input.configPath.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
      )
    )
      fail(
        "node_fleet_legacy_transition_required",
        "The legacy launchd service is not the exact repository Node being replaced.",
      );
  } else if (
    !text.includes("Description=Lervo Node") ||
    !text.includes("--config") ||
    !text.includes(input.configPath)
  ) {
    fail(
      "node_fleet_legacy_transition_required",
      "The legacy systemd service is not the exact repository Node being replaced.",
    );
  }
  const run =
    input.serviceOptions?.runCommand ??
    (async (command: string, args: string[]) => {
      const { execFile } = await import("node:child_process");
      return new Promise<{ exitCode: number | null }>((done) =>
        execFile(command, args, { timeout: 30_000, windowsHide: true }, (error) =>
          done({
            exitCode: error === null ? 0 : typeof error.code === "number" ? error.code : null,
          }),
        ),
      );
    });
  const wait =
    input.serviceOptions?.wait ??
    ((durationMs: number) => new Promise<void>((done) => setTimeout(done, durationMs)));
  const uid =
    input.serviceOptions?.uid ?? (typeof process.getuid === "function" ? process.getuid() : null);
  if (input.manager === "launchd" && (!Number.isSafeInteger(uid) || uid! < 0))
    fail("node_fleet_legacy_transition_failed", "The launchd user domain is unavailable.");
  const identity = input.manager === "launchd" ? `gui/${uid}/com.lervo.node` : "lervo-node.service";
  const stopped =
    input.manager === "launchd"
      ? (await run("launchctl", ["bootout", identity])).exitCode === 0 ||
        (await run("launchctl", ["print", identity])).exitCode !== 0
      : (await run("systemctl", ["--user", "disable", "--now", identity])).exitCode === 0;
  if (!stopped)
    fail("node_fleet_legacy_transition_failed", "The legacy singleton could not be stopped.");
  if (input.manager === "launchd") await run("launchctl", ["disable", identity]);
  let consecutive = 0;
  for (let observation = 0; observation < 6 && consecutive < 3; observation += 1) {
    const active =
      input.manager === "launchd"
        ? (await run("launchctl", ["print", identity])).exitCode === 0
        : (await run("systemctl", ["--user", "is-active", identity])).exitCode === 0;
    consecutive = active ? 0 : consecutive + 1;
    if (consecutive < 3) await wait(500);
  }
  if (consecutive < 3)
    fail("node_fleet_legacy_transition_failed", "The legacy singleton did not remain stopped.");
  const home = resolve(input.homeDirectory ?? homedir());
  const archiveDirectory =
    input.manager === "launchd"
      ? resolve(home, "Library", "Application Support", "Lervo", "retired-services")
      : resolve(home, ".local", "share", "lervo", "retired-services");
  await mkdir(archiveDirectory, { recursive: true, mode: 0o700 });
  const suffix = input.contentHash.slice("sha256:".length, "sha256:".length + 16);
  const archive = resolve(
    archiveDirectory,
    `${input.manager === "launchd" ? "com.lervo.node.plist" : "lervo-node.service"}.${suffix}.retired`,
  );
  try {
    await rename(input.path, archive);
  } catch (error) {
    fail(
      "node_fleet_legacy_transition_failed",
      "The stopped legacy definition could not be archived safely.",
      error,
    );
  }
  await chmod(archive, 0o600);
}
