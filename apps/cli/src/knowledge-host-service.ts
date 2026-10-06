import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defaultRepositoryRegistryPath } from "@lervo/repository-registry";
import {
  defaultConvergenceContinuityPolicyPath,
  hostKnowledgeResidentStatusPath,
  readConvergenceContinuityPolicy,
  readHostKnowledgeResidentStatus,
} from "@lervo/repository-knowledge-runtime";

// These release-tested service primitives are bundled into the installed CLI.
// @ts-expect-error The repository service script intentionally remains plain ESM.
import { manageRuntimeService } from "../../../scripts/distribution/manage-runtime-service.mjs";
import {
  formatRuntimeServiceDefinition,
  runtimeServiceTargetPath,
  // @ts-expect-error The repository service script intentionally remains plain ESM.
} from "../../../scripts/distribution/render-runtime-service.mjs";

import {
  hostResidentCandidates,
  type HostResidentCandidates,
} from "./knowledge-host-resident-candidates.js";
import {
  createKnowledgeHostServiceConfig,
  KNOWLEDGE_HOST_SERVICE_CONFIG_PATH,
  readKnowledgeHostServiceConfig,
  type KnowledgeHostServiceConfig,
} from "./knowledge-host-service-config.js";
import {
  writeManagedUserService,
  type ManagedServiceStatus,
} from "./managed-user-service-write.js";
import { resolveServiceToolDirectories } from "./service-tool-directories.js";
import type { UpgradeStageBlocker } from "./upgrade-stage-inspection.js";
import type { StageDisposition } from "./upgrade-stage-policy.js";

const RUNTIME = "knowledge-host";

export interface KnowledgeHostServicePorts {
  platform: NodeJS.Platform;
  homeDirectory: string;
  uid: number | null;
  environment: NodeJS.ProcessEnv;
  cliEntry(): Promise<string>;
  nodeExecutable(): Promise<string>;
  candidates(): Promise<HostResidentCandidates>;
  policyActive(): Promise<boolean>;
  manage(args: string[], options: Record<string, unknown>): Promise<ManagedServiceStatus>;
  residentLaunch(): Promise<"service" | "manual" | null>;
}

async function policyActive(): Promise<boolean> {
  const path = defaultConvergenceContinuityPolicyPath();
  if (path === null) return false;
  const policy = await readConvergenceContinuityPolicy(path);
  return policy.status === "loaded" && policy.policy.state === "active";
}

async function residentLaunch(): Promise<"service" | "manual" | null> {
  const path = hostKnowledgeResidentStatusPath();
  if (path === null) return null;
  const reading = await readHostKnowledgeResidentStatus(path);
  return reading.status === "running" && reading.record.role === "active"
    ? reading.record.launch
    : null;
}

export function defaultKnowledgeHostServicePorts(): KnowledgeHostServicePorts {
  return {
    platform: process.platform,
    homeDirectory: homedir(),
    uid: typeof process.getuid === "function" ? process.getuid() : null,
    environment: process.env,
    cliEntry: () => realpath(fileURLToPath(new URL("./bin.js", import.meta.url))),
    nodeExecutable: () => realpath(process.execPath),
    candidates: () => hostResidentCandidates(null),
    policyActive,
    manage: (args, options) => manageRuntimeService(args, options) as Promise<ManagedServiceStatus>,
    residentLaunch,
  };
}

/** ADR-0470 upgrade stage: the one host resident service that serves every unserved checkout. */
export interface HostResidentServiceStage {
  disposition: StageDisposition;
  reason: string;
  manager: "launchd" | "systemd" | null;
  serviceIdentity: string | null;
  action: "none" | "install" | "activate" | "upgrade";
  /** SHA-256 of the canonical definition this host should run; null when not applicable. */
  definitionHash: string | null;
  installedDefinitionHash: string | null;
  configAction: "create" | "unchanged" | "none";
  configHash: string | null;
  /** Checkouts without a Node that the host resident serves. */
  servedRepositoryCount: number;
  nodeServedRepositoryCount: number;
  /** A host resident already running outside the managed service; it hands over on stop. */
  unmanagedResidentRunning: boolean;
  blockers: UpgradeStageBlocker[];
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function managerFor(platform: NodeJS.Platform): "launchd" | "systemd" | null {
  return platform === "darwin" ? "launchd" : platform === "linux" ? "systemd" : null;
}

interface PreparedHostService {
  stage: HostResidentServiceStage;
  definition: string | null;
  installed: Buffer | null;
  config: KnowledgeHostServiceConfig | null;
  coordinates: {
    executable: string;
    nodeExecutable: string;
    configPath: string;
    pathDirectories: string[];
  } | null;
}

function notApplicable(
  reason: string,
  counts: Pick<HostResidentServiceStage, "servedRepositoryCount" | "nodeServedRepositoryCount">,
  disposition: StageDisposition = "current",
  blockers: UpgradeStageBlocker[] = [],
): PreparedHostService {
  return {
    stage: {
      disposition,
      reason,
      manager: null,
      serviceIdentity: null,
      action: "none",
      definitionHash: null,
      installedDefinitionHash: null,
      configAction: "none",
      configHash: null,
      ...counts,
      unmanagedResidentRunning: false,
      blockers,
    },
    definition: null,
    installed: null,
    config: null,
    coordinates: null,
  };
}

async function readInstalled(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function prepareHostService(ports: KnowledgeHostServicePorts): Promise<PreparedHostService> {
  const candidates = await ports.candidates();
  const counts = {
    servedRepositoryCount: candidates.wanted.size,
    nodeServedRepositoryCount: candidates.nodeServed.length,
  };
  if (candidates.wanted.size === 0)
    return notApplicable(
      candidates.nodeServed.length > 0 ? "all_repositories_node_served" : "continuity_not_enrolled",
      counts,
    );
  const manager = managerFor(ports.platform);
  if (manager === null)
    return notApplicable("service_manager_unsupported", counts, "pending_authority", [
      {
        code: "service_manager_unsupported",
        message:
          "This operating system has no supported user service manager. Run `lervo knowledge worker --watch --host` under your own supervisor, or use WSL.",
      },
    ]);
  const userStateDirectory = dirname(defaultRepositoryRegistryPath(ports.environment));
  const configPath = resolve(userStateDirectory, KNOWLEDGE_HOST_SERVICE_CONFIG_PATH);
  const [executable, nodeExecutable, configReading, launch] = await Promise.all([
    ports.cliEntry(),
    ports.nodeExecutable(),
    readKnowledgeHostServiceConfig(configPath),
    ports.residentLaunch(),
  ]);
  if (configReading.status === "invalid")
    return notApplicable("host_service_config_invalid", counts, "blocked", [
      {
        code: "host_service_config_invalid",
        message: `The host resident configuration (${KNOWLEDGE_HOST_SERVICE_CONFIG_PATH} in the Lervo user state directory) fails its contract. Fix it, or delete it so the next upgrade writes it again.`,
      },
    ]);
  const config: KnowledgeHostServiceConfig =
    configReading.status === "loaded"
      ? configReading.config
      : { schemaVersion: 1, userStateDirectory, provider: null };
  const tools = await resolveServiceToolDirectories({
    providers: [...new Set(candidates.wanted.values())],
    searchPath: ports.environment.PATH,
  });
  if (tools.missing.length > 0)
    return notApplicable("service_tool_unresolved", counts, "blocked", [
      {
        code: "service_tool_unresolved",
        message: `The host resident needs ${tools.missing.join(", ")}, but no directory on this shell's PATH provides it. Install it or add its directory to PATH, then rerun \`lervo upgrade\`.`,
      },
    ]);
  const identity = { manager, runtime: RUNTIME, instance: null };
  const definition = formatRuntimeServiceDefinition({
    ...identity,
    executable,
    nodeExecutable,
    pathDirectories: tools.directories,
    config: configPath,
  }) as string;
  const options = { homeDirectory: ports.homeDirectory, platform: ports.platform, uid: ports.uid };
  const status = await ports.manage(
    ["--action", "status", "--manager", manager, "--runtime", RUNTIME],
    options,
  );
  const installed = await readInstalled(
    runtimeServiceTargetPath(identity, ports.homeDirectory) as string,
  );
  const definitionHash = sha256(definition);
  const installedDefinitionHash = installed === null ? null : sha256(installed);
  const base = {
    manager,
    serviceIdentity:
      manager === "launchd" ? "com.lervo.knowledge.host" : "lervo-knowledge-host.service",
    definitionHash,
    installedDefinitionHash,
    configAction: configReading.status === "loaded" ? ("unchanged" as const) : ("create" as const),
    configHash: sha256(JSON.stringify(config)),
    ...counts,
    unmanagedResidentRunning: launch === "manual",
  };
  const prepared = (
    disposition: StageDisposition,
    reason: string,
    action: HostResidentServiceStage["action"],
    blockers: UpgradeStageBlocker[] = [],
  ): PreparedHostService => ({
    stage: { disposition, reason, action, ...base, blockers },
    definition,
    installed,
    config,
    coordinates: { executable, nodeExecutable, configPath, pathDirectories: tools.directories },
  });
  if (!status.managerAvailable)
    return prepared("blocked", "service_manager_unavailable", "none", [
      {
        code: "service_manager_unavailable",
        message:
          manager === "systemd"
            ? "The systemd user manager is not running. On WSL, set `[boot] systemd=true` in /etc/wsl.conf and restart WSL; elsewhere enable lingering or log in, then rerun `lervo upgrade`."
            : "The launchd user domain is unavailable. Run `lervo upgrade` from the logged-in user's session.",
      },
    ]);
  if (installedDefinitionHash === definitionHash && configReading.status === "loaded")
    return status.active && status.enabled !== false
      ? prepared("current", "host_service_current", "none")
      : prepared("safe_apply", "host_service_inactive", "activate");
  if (installed === null)
    return status.active || status.enabled === true
      ? prepared("blocked", "service_state_conflict", "none", [
          {
            code: "service_state_conflict",
            message:
              "The service manager retains a Lervo knowledge host service without its definition. Remove it with launchctl bootout or systemctl --user disable --now, then rerun `lervo upgrade`.",
          },
        ])
      : prepared("safe_apply", "host_service_missing", "install");
  return installedDefinitionHash === definitionHash
    ? prepared("safe_apply", "host_service_inactive", "activate")
    : prepared("safe_apply", "host_service_outdated", "upgrade");
}

/** Read-only: what the upgrade would install, activate, or replace for the host resident. */
export async function inspectHostResidentService(
  ports: KnowledgeHostServicePorts = defaultKnowledgeHostServicePorts(),
): Promise<HostResidentServiceStage> {
  return (await prepareHostService(ports)).stage;
}

export interface HostResidentServiceReceipt {
  change: string;
  configCreated: boolean;
}

/**
 * Installs, activates, or transactionally replaces the host resident service through the
 * release-tested service manager, after re-planning against the approved stage. The manager
 * never overwrites differing bytes it was not given as the exact predecessor.
 */
export async function applyHostResidentService(
  approved: HostResidentServiceStage,
  ports: KnowledgeHostServicePorts = defaultKnowledgeHostServicePorts(),
): Promise<HostResidentServiceReceipt | null> {
  const current = await prepareHostService(ports);
  if (current.stage.disposition === "current") return null;
  if (
    current.stage.disposition !== "safe_apply" ||
    current.stage.action !== approved.action ||
    current.stage.definitionHash !== approved.definitionHash ||
    current.stage.installedDefinitionHash !== approved.installedDefinitionHash ||
    current.stage.configHash !== approved.configHash
  )
    throw Object.assign(new Error("The host resident service changed after planning."), {
      code: "host_service_plan_stale",
    });
  const { coordinates, definition, installed, config } = current;
  let configCreated = false;
  if (current.stage.configAction === "create")
    configCreated = await createKnowledgeHostServiceConfig(coordinates!.configPath, config!);
  const result = await writeManagedUserService({
    manage: ports.manage,
    options: { homeDirectory: ports.homeDirectory, platform: ports.platform, uid: ports.uid },
    manager: current.stage.manager!,
    runtime: RUNTIME,
    action: current.stage.action as "install" | "activate" | "upgrade",
    definition: definition!,
    installed,
    coordinates: coordinates!,
  });
  if (!result.managerAvailable || !result.installed || !result.active || result.enabled === false)
    throw Object.assign(new Error("The host resident service did not remain active."), {
      code: "host_service_unavailable",
    });
  return { change: result.change ?? "unchanged", configCreated };
}
