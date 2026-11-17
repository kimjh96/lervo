import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, resolve } from "node:path";

// These release-tested service primitives are bundled into the installed CLI.
// @ts-expect-error The repository service script intentionally remains plain ESM.
import { manageRuntimeService } from "../../../scripts/distribution/manage-runtime-service.mjs";
import {
  formatRuntimeServiceDefinition,
  runtimeServiceTargetPath,
  // @ts-expect-error The repository service script intentionally remains plain ESM.
} from "../../../scripts/distribution/render-runtime-service.mjs";

import { CommandFailure } from "./command-error-output.js";
import {
  pointFollowRuntime,
  readActiveCli,
  recordedInstallRepository,
  REPOSITORY_UNKNOWN_MESSAGE,
} from "./host-follow-runtime.js";
import type { HostUpgradeLayout } from "./host-upgrade-layout.js";
import {
  writeManagedUserService,
  type ManagedServiceStatus,
} from "./managed-user-service-write.js";

const RUNTIME = "host-follow";

export interface HostFollowServicePorts {
  platform: NodeJS.Platform;
  homeDirectory: string;
  uid: number | null;
  /** The installing shell's PATH; the follower restores it for every tool it runs. */
  searchPath: string | undefined;
  nodeExecutable(): Promise<string>;
  manage(args: string[], options: Record<string, unknown>): Promise<ManagedServiceStatus>;
}

export function defaultHostFollowServicePorts(homeDirectory: string): HostFollowServicePorts {
  return {
    platform: process.platform,
    homeDirectory,
    uid: typeof process.getuid === "function" ? process.getuid() : null,
    searchPath: process.env.PATH,
    nodeExecutable: () => realpath(process.execPath),
    manage: (args, options) => manageRuntimeService(args, options) as Promise<ManagedServiceStatus>,
  };
}

/**
 * The file the service passes as `--config`. A service manager starts the follower without a
 * login shell, so it keeps the installing shell's PATH: `gh`, `pnpm`, `git`, providers, and every
 * `lervo upgrade` it runs then resolve exactly as in that shell, and repository upgrades plan the
 * same service definitions a manual run would. `repository` null means the repository this host
 * last installed a release from, as its activation journal records it.
 */
export interface HostFollowServiceConfig {
  schemaVersion: 1;
  repository: string | null;
  binDirectory: string;
  searchPath: string;
}

export interface HostFollowServicePlan {
  /** What the owner asked for; `action` is what the service manager would do for it. */
  request: "install" | "remove";
  manager: "launchd" | "systemd";
  serviceIdentity: string;
  action: "none" | "install" | "activate" | "upgrade" | "remove";
  definitionHash: string;
  installedDefinitionHash: string | null;
  configAction: "create" | "replace" | "unchanged" | "none";
  status: ManagedServiceStatus;
  blocker: { code: string; message: string } | null;
}

const sha256 = (value: string | Uint8Array) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const managerOf = (platform: NodeJS.Platform) => (platform === "darwin" ? "launchd" : "systemd");

/** The service manager's read-only view of the follower service, or null when unobservable. */
export function readFollowServiceStatus(
  ports: HostFollowServicePorts,
): Promise<ManagedServiceStatus | null> {
  return ports
    .manage(["--action", "status", "--manager", managerOf(ports.platform), "--runtime", RUNTIME], {
      homeDirectory: ports.homeDirectory,
      platform: ports.platform,
      uid: ports.uid,
    })
    .catch(() => null);
}

/** launchd only appends to this file; the follower bounds it at start (ADR-0555). */
export function hostFollowLogPath(homeDirectory: string): string {
  return resolve(homeDirectory, "Library", "Logs", "Lervo", "host-follow.log");
}

function searchPathOf(value: string | undefined): string {
  return (value ?? "")
    .split(delimiter)
    .filter((entry) => isAbsolute(entry) && resolve(entry) === entry && !/[\0\r\n]/u.test(entry))
    .filter((entry, index, entries) => entries.indexOf(entry) === index)
    .join(delimiter);
}

export async function readFollowServiceConfig(
  path: string,
): Promise<HostFollowServiceConfig | null> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    value = undefined;
  }
  const config = value as Partial<HostFollowServiceConfig> | undefined;
  if (
    config === undefined ||
    config === null ||
    config.schemaVersion !== 1 ||
    !(config.repository === null || typeof config.repository === "string") ||
    typeof config.binDirectory !== "string" ||
    !isAbsolute(config.binDirectory) ||
    typeof config.searchPath !== "string"
  )
    throw new CommandFailure(
      "host_follow_config_invalid",
      `${path} is not a follower configuration; reinstall the service with lervo host upgrade --follow --service install --apply.`,
      { path },
    );
  return config as HostFollowServiceConfig;
}

function coordinates(layout: HostUpgradeLayout, ports: HostFollowServicePorts, node: string) {
  const logFile = ports.platform === "darwin" ? hostFollowLogPath(ports.homeDirectory) : undefined;
  return {
    executable: resolve(layout.follow.runtimePointer, "dist", "bin.js"),
    nodeExecutable: node,
    configPath: layout.follow.configPath,
    pathDirectories: [] as string[],
    ...(logFile === undefined ? {} : { logFile }),
  };
}

interface PreparedFollowService {
  plan: HostFollowServicePlan;
  config: HostFollowServiceConfig;
  definition: string;
}

/** The definition this CLI renders for the follower, and the installed bytes, if any. */
async function followDefinitions(
  layout: HostUpgradeLayout,
  ports: HostFollowServicePorts,
): Promise<{ definition: string; installed: Buffer | null }> {
  const identity = { manager: managerOf(ports.platform), runtime: RUNTIME, instance: null };
  const service = coordinates(layout, ports, await ports.nodeExecutable());
  const definition = formatRuntimeServiceDefinition({
    ...identity,
    executable: service.executable,
    nodeExecutable: service.nodeExecutable,
    pathDirectories: [],
    config: service.configPath,
    ...(service.logFile === undefined ? {} : { logFile: service.logFile }),
  }) as string;
  const installed = await readFile(
    runtimeServiceTargetPath(identity, ports.homeDirectory) as string,
  ).catch(() => null);
  return { definition, installed };
}

/**
 * ADR-0577, read-only: whether the installed follower definition is the one this CLI renders.
 * The follower never re-renders its own service, because replacing it would stop the running
 * `lervo upgrade`; `definition_outdated` asks the owner to run `--service install --apply` while
 * no pass is in flight. Null when the definition cannot be rendered or read.
 */
export type FollowServiceDefinition = "current" | "definition_outdated" | "not_installed" | null;

export async function inspectFollowServiceDefinition(
  layout: HostUpgradeLayout,
  ports: HostFollowServicePorts,
): Promise<FollowServiceDefinition> {
  try {
    const { definition, installed } = await followDefinitions(layout, ports);
    if (installed === null) return "not_installed";
    return sha256(installed) === sha256(definition) ? "current" : "definition_outdated";
  } catch {
    return null;
  }
}

async function prepareFollowService(
  layout: HostUpgradeLayout,
  ports: HostFollowServicePorts,
  input: { operation: "install" | "remove"; repository: string | null },
): Promise<PreparedFollowService> {
  const manager = managerOf(ports.platform);
  const { definition, installed } = await followDefinitions(layout, ports);
  const status = await ports.manage(
    ["--action", "status", "--manager", manager, "--runtime", RUNTIME],
    { homeDirectory: ports.homeDirectory, platform: ports.platform, uid: ports.uid },
  );
  const config: HostFollowServiceConfig = {
    schemaVersion: 1,
    repository: input.repository,
    binDirectory: layout.binDirectory,
    searchPath: searchPathOf(ports.searchPath),
  };
  const existing = await readFollowServiceConfig(layout.follow.configPath).catch(() => undefined);
  const definitionHash = sha256(definition);
  const installedDefinitionHash = installed === null ? null : sha256(installed);
  let blocker: HostFollowServicePlan["blocker"] = null;
  let action: HostFollowServicePlan["action"];
  if (input.operation === "remove") action = installed === null ? "none" : "remove";
  else if (installed === null)
    action = status.active || status.enabled === true ? "none" : "install";
  else if (installedDefinitionHash !== definitionHash) action = "upgrade";
  else action = status.active && status.enabled !== false ? "none" : "activate";
  if (!status.managerAvailable)
    blocker = {
      code: "service_manager_unavailable",
      message:
        manager === "systemd"
          ? "The systemd user manager is not running. On WSL, set `[boot] systemd=true` in /etc/wsl.conf; elsewhere enable lingering or log in, then rerun."
          : "The launchd user domain is unavailable. Run this from the logged-in user's session.",
    };
  else if (input.operation === "install" && installed === null && action === "none")
    blocker = {
      code: "service_state_conflict",
      message:
        "The service manager retains a Lervo follower service without its definition. Remove it with launchctl bootout or systemctl --user disable --now, then rerun.",
    };
  else if (input.operation === "install" && (await readActiveCli(layout)).packageRoot === null)
    blocker = {
      code: "host_follow_cli_missing",
      message: `No managed lervo link in ${layout.binDirectory} names an installed CLI; install one with lervo host upgrade --from-release first.`,
    };
  else if (
    input.operation === "install" &&
    input.repository === null &&
    (await recordedInstallRepository(layout)) === null
  )
    blocker = { code: "host_follow_repository_unknown", message: REPOSITORY_UNKNOWN_MESSAGE };
  return {
    plan: {
      request: input.operation,
      manager,
      serviceIdentity:
        manager === "launchd" ? "com.lervo.host.follow" : "lervo-host-follow.service",
      action,
      definitionHash,
      installedDefinitionHash,
      configAction:
        input.operation === "remove"
          ? "none"
          : existing === null
            ? "create"
            : JSON.stringify(existing) === JSON.stringify(config)
              ? "unchanged"
              : "replace",
      status,
      blocker,
    },
    config,
    definition,
  };
}

/** Read-only: what installing or removing the follower service would change. */
export async function planFollowService(
  layout: HostUpgradeLayout,
  ports: HostFollowServicePorts,
  input: { operation: "install" | "remove"; repository: string | null },
): Promise<HostFollowServicePlan> {
  return (await prepareFollowService(layout, ports, input)).plan;
}

async function writeConfig(path: string, config: HostFollowServiceConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Installs, activates, replaces, or removes the follower service. Install first points the
 * follower runtime link at the CLI the `lervo` link runs, so the service starts on it.
 */
export async function applyFollowService(
  layout: HostUpgradeLayout,
  ports: HostFollowServicePorts,
  input: { operation: "install" | "remove"; repository: string | null },
): Promise<HostFollowServicePlan & { change: string }> {
  const { plan, config, definition } = await prepareFollowService(layout, ports, input);
  if (plan.blocker !== null)
    throw new CommandFailure(plan.blocker.code, plan.blocker.message, { action: plan.action });
  if (input.operation === "install") {
    const active = await readActiveCli(layout);
    await pointFollowRuntime(layout, active.packageRoot!);
    if (plan.configAction !== "unchanged") await writeConfig(layout.follow.configPath, config);
  }
  if (plan.action === "none") return { ...plan, change: "unchanged" };
  const service = coordinates(layout, ports, await ports.nodeExecutable());
  // launchd opens the output path itself and does not create missing directories.
  if (service.logFile !== undefined)
    await mkdir(dirname(service.logFile), { recursive: true, mode: 0o700 });
  const installed = await readFile(
    runtimeServiceTargetPath(
      { manager: plan.manager, runtime: RUNTIME, instance: null },
      ports.homeDirectory,
    ) as string,
  ).catch(() => null);
  const status = await writeManagedUserService({
    manage: ports.manage,
    options: { homeDirectory: ports.homeDirectory, platform: ports.platform, uid: ports.uid },
    manager: plan.manager,
    runtime: RUNTIME,
    action: plan.action,
    definition,
    installed,
    coordinates: service,
  });
  if (plan.action !== "remove" && (!status.installed || !status.active))
    throw new CommandFailure(
      "host_follow_service_unavailable",
      "The follower service did not remain active.",
    );
  return { ...plan, status, change: status.change ?? plan.action };
}
