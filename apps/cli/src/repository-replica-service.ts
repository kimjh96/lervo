import { createHash } from "node:crypto";
import { chmod, lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { defaultNodeFleetRegistryPath, listNodeFleetInstances } from "@lervo/repository-registry";

// These release-tested service primitives are bundled into the installed CLI.
// @ts-expect-error The repository service script intentionally remains plain ESM.
import { manageRuntimeService } from "../../../scripts/distribution/manage-runtime-service.mjs";
import {
  formatRuntimeServiceDefinition,
  runtimeServiceTargetPath,
  // @ts-expect-error The repository service script intentionally remains plain ESM.
} from "../../../scripts/distribution/render-runtime-service.mjs";

import { materializeInstalledNodeLauncher } from "./node-fleet-runtime-material.js";
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

interface ServiceStatus {
  managerAvailable: boolean;
  installed: boolean;
  enabled: boolean | null;
  active: boolean;
  change?: string;
}

export interface RepositoryReplicaServicePorts {
  platform: NodeJS.Platform;
  homeDirectory: string;
  uid: number | null;
  environment: NodeJS.ProcessEnv;
  /** The `<hash16>` directory the runtime bundled with this CLI installs into. */
  bundledRuntime(): Promise<string>;
  materializeRuntime(): Promise<void>;
  /** Whether this host runs any registered Node, which makes it a replica peer candidate. */
  hostRunsNodes(): Promise<boolean>;
  nodeExecutable(): Promise<string>;
  manage(args: string[], options: Record<string, unknown>): Promise<ServiceStatus>;
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function hostRunsNodes(environment: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    return (await listNodeFleetInstances(defaultNodeFleetRegistryPath(environment))).length > 0;
  } catch {
    return false;
  }
}

export function defaultRepositoryReplicaServicePorts(): RepositoryReplicaServicePorts {
  const home = homedir();
  return {
    platform: process.platform,
    homeDirectory: home,
    uid: typeof process.getuid === "function" ? process.getuid() : null,
    environment: process.env,
    bundledRuntime: async () => {
      const bytes = await readFile(new URL("./node-runtime.js", import.meta.url));
      return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    },
    materializeRuntime: async () => {
      await materializeInstalledNodeLauncher(home);
    },
    hostRunsNodes: () => hostRunsNodes(process.env),
    nodeExecutable: () => realpath(process.execPath),
    manage: (args, options) => manageRuntimeService(args, options) as Promise<ServiceStatus>,
  };
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
  action: "none" | "install" | "activate" | "upgrade";
  definitionHash: string | null;
  installedDefinitionHash: string | null;
  blockers: UpgradeStageBlocker[];
}

interface PreparedReplicaService {
  stage: RepositoryReplicaServiceStage;
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
  const [coordinates, runsNodes] = await Promise.all([
    regularFile(configPath),
    ports.hostRunsNodes(),
  ]);
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
    blockers: [],
  };
  if (manager === null || (!coordinates && !runsNodes))
    return { stage: empty, definition: null, installed: null, coordinates: null };
  const runtime = await ports.bundledRuntime();
  const pointed = await readCurrentNodeRuntime(ports.homeDirectory, ports.platform);
  const pointerAction = pointed === runtime ? "none" : pointed === null ? "create" : "update";
  const pointerStage = { ...empty, runtime, pointerAction } as RepositoryReplicaServiceStage;
  if (!coordinates)
    return {
      stage:
        pointerAction === "none"
          ? { ...pointerStage, reason: "runtime_pointer_current" }
          : { ...pointerStage, disposition: "safe_apply", reason: "runtime_pointer_stale" },
      definition: null,
      installed: null,
      coordinates: null,
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
        pointerAction !== "none" && disposition === "current" ? "safe_apply" : disposition,
      reason:
        pointerAction !== "none" && disposition === "current" ? "runtime_pointer_stale" : reason,
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
  if (installedDefinitionHash === definitionHash)
    return status.active && status.enabled !== false
      ? prepared("current", "replica_service_current", "none")
      : prepared("safe_apply", "replica_service_inactive", "activate");
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
  serviceChange: string | null;
}

/**
 * Activates the bundled runtime as `current` with one rename, then installs, activates, or
 * replaces the coordinator service through the release-tested service manager. It re-plans
 * first and refuses a plan that changed since approval.
 */
export async function applyRepositoryReplicaService(
  approved: RepositoryReplicaServiceStage,
  ports: RepositoryReplicaServicePorts = defaultRepositoryReplicaServicePorts(),
): Promise<RepositoryReplicaServiceReceipt | null> {
  const current = await prepareReplicaService(ports);
  if (current.stage.disposition === "current") return null;
  if (
    current.stage.disposition !== "safe_apply" ||
    current.stage.runtime !== approved.runtime ||
    current.stage.pointerAction !== approved.pointerAction ||
    current.stage.action !== approved.action ||
    current.stage.definitionHash !== approved.definitionHash ||
    current.stage.installedDefinitionHash !== approved.installedDefinitionHash
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
  if (current.stage.action === "none")
    return { pointerAction: current.stage.pointerAction, serviceChange: null };
  const { coordinates, definition, installed } = current;
  const directory = await mkdtemp(resolve(tmpdir(), "lervo-repository-replica-service-"));
  try {
    const definitionPath = resolve(directory, "service-definition");
    await writeFile(definitionPath, definition!, { mode: 0o600, flag: "wx" });
    await chmod(definitionPath, 0o600);
    const previous: string[] = [];
    if (current.stage.action === "upgrade") {
      const previousPath = resolve(directory, "previous-service-definition");
      await writeFile(previousPath, installed!, { mode: 0o600, flag: "wx" });
      await chmod(previousPath, 0o600);
      previous.push("--previous-definition", previousPath);
    }
    const result = await ports.manage(
      [
        "--action",
        current.stage.action === "upgrade" ? "upgrade" : "install",
        "--manager",
        current.stage.manager!,
        "--runtime",
        RUNTIME,
        "--definition",
        definitionPath,
        ...previous,
        "--executable",
        coordinates!.executable,
        "--node-executable",
        coordinates!.nodeExecutable,
        ...(coordinates!.pathDirectories.length === 0
          ? []
          : ["--path-directories", coordinates!.pathDirectories.join(":")]),
        "--config",
        coordinates!.configPath,
        "--write",
      ],
      { homeDirectory: ports.homeDirectory, platform: ports.platform, uid: ports.uid },
    );
    if (!result.managerAvailable || !result.installed || !result.active || result.enabled === false)
      throw Object.assign(new Error("The repository replica service did not remain active."), {
        code: "replica_service_unavailable",
      });
    return {
      pointerAction: current.stage.pointerAction,
      serviceChange: result.change ?? "unchanged",
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
