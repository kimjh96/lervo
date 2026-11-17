import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { defaultNodeFleetRegistryPath } from "@lervo/repository-registry";

import {
  formatRuntimeServiceDefinition,
  runtimeServiceTargetPath,
  // @ts-expect-error The repository service script intentionally remains plain ESM.
} from "../../../scripts/distribution/render-runtime-service.mjs";

import { writeManagedUserService } from "./managed-user-service-write.js";
import {
  planReplicaConfigMigration,
  retireLegacyReplicaConfig,
  writeMigratedReplicaConfig,
  type ReplicaConfigMigration,
} from "./repository-replica-config-migration.js";
import { configuredReplicaPeerLauncher } from "./repository-replica-peer-launcher.js";
import { observeReplicaProcessRuntime } from "./repository-replica-process-runtime.js";
import {
  REPOSITORY_REPLICA_SERVICE_LOCK_FILE,
  withRepositoryReplicaServiceLock,
} from "./repository-replica-service-lock.js";
import {
  defaultRepositoryReplicaServicePorts,
  type RepositoryReplicaServicePorts,
} from "./repository-replica-service-ports.js";
import {
  currentNodeRuntimePayload,
  pointCurrentNodeRuntime,
  readCurrentNodeRuntime,
} from "./node-runtime-pointer.js";
import { resolveServiceToolDirectories } from "./service-tool-directories.js";
import type { UpgradeStageBlocker } from "./upgrade-stage-inspection.js";
import type { StageDisposition } from "./upgrade-stage-policy.js";

const RUNTIME = "repository-replica";
/** The coordinator configuration this stage manages a service for, in the user state directory. */
export const REPOSITORY_REPLICA_CONFIG_FILE = "repository-replica-coordinator.json";

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/**
 * ADR-0483 upgrade stage: this host's `current` Node runtime pointer, which a peer coordinator's
 * commands run through, and the managed replica coordinator service when this host coordinates.
 * The plan carries hashes and the runtime directory name only, never paths.
 */
export interface RepositoryReplicaServiceStage {
  disposition: StageDisposition;
  reason: string;
  /** The `<hash16>` runtime `current` should name; null when this host keeps no pointer. */
  runtime: string | null;
  pointerAction: "none" | "create" | "update";
  manager: "launchd" | "systemd" | null;
  serviceIdentity: string | null;
  /** `restart`: ADR-0573, the unchanged definition's running process loaded another runtime. */
  action: "none" | "install" | "activate" | "upgrade" | "restart";
  definitionHash: string | null;
  installedDefinitionHash: string | null;
  /** `migrate`: the legacy `~/.lervo` configuration moves into the user state directory. */
  configMigration: "none" | "migrate";
  migratedConfigHash: string | null;
  /** The migrated peer keeps an explicit runtime path, which goes stale at the next deploy. */
  peerRuntimeOverride: boolean;
  /** ADR-0570: the per-call launcher name, such as `wsl.exe`, every peer step runs through. */
  peerLauncher: string | null;
  blockers: UpgradeStageBlocker[];
}

interface PreparedReplicaService {
  stage: RepositoryReplicaServiceStage;
  migration: ReplicaConfigMigration | null;
  definition: string | null;
  installed: Buffer | null;
  coordinates: {
    executable: string;
    nodeExecutable: string;
    configPath: string;
    pathDirectories: string[];
  } | null;
}

async function regularFile(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

async function readInstalled(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** The managed coordinator configuration: the user state directory beside `repositories.json`. */
export function repositoryReplicaConfigPath(environment: NodeJS.ProcessEnv): string {
  return resolve(
    dirname(defaultNodeFleetRegistryPath(environment)),
    REPOSITORY_REPLICA_CONFIG_FILE,
  );
}

async function prepareReplicaService(
  ports: RepositoryReplicaServicePorts,
): Promise<PreparedReplicaService> {
  const manager =
    ports.platform === "darwin" ? "launchd" : ports.platform === "linux" ? "systemd" : null;
  const configPath = repositoryReplicaConfigPath(ports.environment);
  const [configured, runsNodes] = await Promise.all([
    regularFile(configPath),
    ports.hostRunsNodes(),
  ]);
  const legacy = configured
    ? ({ status: "none" } as const)
    : await planReplicaConfigMigration({
        legacyPath: ports.legacyConfigPath,
      });
  const migration = legacy.status === "migrate" ? legacy.migration : null;
  const coordinates = configured || migration !== null;
  const empty: RepositoryReplicaServiceStage = {
    disposition: "current",
    reason: "replica_not_configured",
    runtime: null,
    pointerAction: "none",
    manager: null,
    serviceIdentity: null,
    action: "none",
    definitionHash: null,
    installedDefinitionHash: null,
    configMigration: "none",
    migratedConfigHash: null,
    peerRuntimeOverride: false,
    peerLauncher: null,
    blockers: [],
  };
  const unchanged = { definition: null, installed: null, coordinates: null, migration: null };
  if (manager !== null && legacy.status === "invalid")
    return {
      stage: {
        ...empty,
        disposition: "blocked",
        reason: "replica_config_legacy_invalid",
        blockers: [
          {
            code: "replica_config_legacy_invalid",
            message:
              "~/.lervo/repository-replica-coordinator.json is not a readable coordinator configuration, so it cannot move into the Lervo user state directory. Fix or remove it, then rerun `lervo upgrade`.",
          },
        ],
      },
      ...unchanged,
    };
  if (manager === null || (!coordinates && !runsNodes)) return { stage: empty, ...unchanged };
  const runtime = await ports.bundledRuntime();
  const pointed = await readCurrentNodeRuntime(ports.homeDirectory, ports.platform);
  const pointerAction = pointed === runtime ? "none" : pointed === null ? "create" : "update";
  const pointerStage = {
    ...empty,
    runtime,
    pointerAction,
    configMigration: migration === null ? "none" : "migrate",
    migratedConfigHash: migration?.contentHash ?? null,
    peerRuntimeOverride: migration?.peerRuntime === "explicit_override",
    peerLauncher: coordinates ? await configuredReplicaPeerLauncher(configPath, migration) : null,
  } as RepositoryReplicaServiceStage;
  if (!coordinates)
    return {
      stage:
        pointerAction === "none"
          ? { ...pointerStage, reason: "runtime_pointer_current" }
          : { ...pointerStage, disposition: "safe_apply", reason: "runtime_pointer_stale" },
      ...unchanged,
    };
  const executable = currentNodeRuntimePayload(ports.homeDirectory, ports.platform);
  const [nodeExecutable, tools] = await Promise.all([
    ports.nodeExecutable(),
    resolveServiceToolDirectories({ providers: [], searchPath: ports.environment.PATH }),
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
  const prepared = (
    disposition: StageDisposition,
    reason: string,
    action: RepositoryReplicaServiceStage["action"],
    blockers: UpgradeStageBlocker[] = [],
  ): PreparedReplicaService => ({
    stage: {
      ...pointerStage,
      disposition:
        (pointerAction !== "none" || migration !== null) && disposition === "current"
          ? "safe_apply"
          : disposition,
      reason:
        migration !== null && disposition !== "blocked"
          ? "replica_config_legacy"
          : pointerAction !== "none" && disposition === "current"
            ? "runtime_pointer_stale"
            : reason,
      manager,
      serviceIdentity:
        manager === "launchd" ? "dev.lervo.repository-replica" : "lervo-repository-replica.service",
      action,
      definitionHash,
      installedDefinitionHash,
      blockers,
    },
    definition,
    installed,
    coordinates: { executable, nodeExecutable, configPath, pathDirectories: tools.directories },
    migration,
  });
  if (tools.missing.length > 0)
    return prepared("blocked", "service_tool_unresolved", "none", [
      {
        code: "service_tool_unresolved",
        message: `The replica coordinator needs ${tools.missing.join(", ")}, but no directory on this shell's PATH provides it. Install it or add its directory to PATH, then rerun \`lervo upgrade\`.`,
      },
    ]);
  if (!status.managerAvailable)
    return prepared("blocked", "service_manager_unavailable", "none", [
      {
        code: "service_manager_unavailable",
        message:
          "The user service manager is unavailable. Run `lervo upgrade` from the logged-in user's session.",
      },
    ]);
  if (installedDefinitionHash === definitionHash) {
    if (!status.active || status.enabled === false)
      return prepared("safe_apply", "replica_service_inactive", "activate");
    // ADR-0573: an unchanged definition names `current`, so only a restart loads a new runtime.
    const processRuntime = await observeReplicaProcessRuntime({
      status,
      runtime,
      homeDirectory: ports.homeDirectory,
      platform: ports.platform,
      observeProcess: ports.observeProcess,
    });
    return processRuntime === "current"
      ? prepared("current", "replica_service_current", "none")
      : prepared("safe_apply", "replica_service_stale_runtime", "restart");
  }
  if (installed === null)
    return status.active || status.enabled === true
      ? prepared("blocked", "service_state_conflict", "none", [
          {
            code: "service_state_conflict",
            message:
              "The service manager retains a repository replica service without its definition. Remove it with launchctl bootout or systemctl --user disable --now, then rerun `lervo upgrade`.",
          },
        ])
      : prepared("safe_apply", "replica_service_missing", "install");
  // A hand-written or older definition under the same label is replaced transactionally; the
  // service manager restores it if the new coordinator does not stay active.
  return prepared("safe_apply", "replica_service_outdated", "upgrade");
}

/** Read-only: the pointer and replica service changes `lervo upgrade` would make on this host. */
export async function inspectRepositoryReplicaService(
  ports: RepositoryReplicaServicePorts = defaultRepositoryReplicaServicePorts(),
): Promise<RepositoryReplicaServiceStage> {
  return (await prepareReplicaService(ports)).stage;
}

export interface RepositoryReplicaServiceReceipt {
  pointerAction: RepositoryReplicaServiceStage["pointerAction"];
  configMigration: RepositoryReplicaServiceStage["configMigration"];
  serviceChange: string | null;
}

/**
 * Activates the bundled runtime as `current` with one rename, then installs, activates,
 * replaces, or restarts the coordinator service through the release-tested service manager.
 * It holds the host's replica service lock, re-plans inside it, and refuses a plan that changed
 * since approval.
 */
export async function applyRepositoryReplicaService(
  approved: RepositoryReplicaServiceStage,
  ports: RepositoryReplicaServicePorts = defaultRepositoryReplicaServicePorts(),
): Promise<RepositoryReplicaServiceReceipt | null> {
  // ADR-0573: upgrades in different repositories share this host's one coordinator service.
  return withRepositoryReplicaServiceLock(
    resolve(
      dirname(defaultNodeFleetRegistryPath(ports.environment)),
      REPOSITORY_REPLICA_SERVICE_LOCK_FILE,
    ),
    () => applyLockedReplicaService(approved, ports),
  );
}

async function applyLockedReplicaService(
  approved: RepositoryReplicaServiceStage,
  ports: RepositoryReplicaServicePorts,
): Promise<RepositoryReplicaServiceReceipt | null> {
  const current = await prepareReplicaService(ports);
  if (current.stage.disposition === "current") return null;
  if (
    current.stage.disposition !== "safe_apply" ||
    current.stage.runtime !== approved.runtime ||
    current.stage.pointerAction !== approved.pointerAction ||
    current.stage.action !== approved.action ||
    current.stage.definitionHash !== approved.definitionHash ||
    current.stage.installedDefinitionHash !== approved.installedDefinitionHash ||
    current.stage.migratedConfigHash !== approved.migratedConfigHash
  )
    throw Object.assign(new Error("The repository replica service changed after planning."), {
      code: "replica_service_plan_stale",
    });
  if (current.stage.pointerAction !== "none") {
    await ports.materializeRuntime();
    await pointCurrentNodeRuntime({
      runtimeDirectory: current.stage.runtime!,
      homeDirectory: ports.homeDirectory,
      platform: ports.platform,
    });
  }
  const { coordinates, definition, installed, migration } = current;
  if (migration !== null) await writeMigratedReplicaConfig(migration, coordinates!.configPath);
  if (current.stage.action === "none") {
    if (migration !== null) await retireLegacyReplicaConfig(migration);
    return {
      pointerAction: current.stage.pointerAction,
      configMigration: current.stage.configMigration,
      serviceChange: null,
    };
  }
  const result = await writeManagedUserService({
    manage: ports.manage,
    options: { homeDirectory: ports.homeDirectory, platform: ports.platform, uid: ports.uid },
    manager: current.stage.manager!,
    runtime: RUNTIME,
    action: current.stage.action,
    definition: definition!,
    installed,
    coordinates: coordinates!,
  });
  if (!result.managerAvailable || !result.installed || !result.active || result.enabled === false)
    throw Object.assign(new Error("The repository replica service did not remain active."), {
      code: "replica_service_unavailable",
    });
  // The service now reads the migrated configuration; the legacy file is no longer read.
  if (migration !== null) await retireLegacyReplicaConfig(migration);
  return {
    pointerAction: current.stage.pointerAction,
    configMigration: current.stage.configMigration,
    serviceChange: result.change ?? "unchanged",
  };
}
