import { resolve } from "node:path";

import {
  defaultRepositoryRegistryPath,
  listRegisteredRepositories,
} from "@lervo/repository-registry";

import { runningCliInstallRoot } from "./cli-install-pointer.js";
import { CommandFailure } from "./command-error-output.js";
import type { HostFollowArguments } from "./host-follow-arguments.js";
import {
  runFollowCycle,
  type HostFollowCycleDependencies,
  type HostFollowCycleOutcome,
} from "./host-follow-cycle.js";
import {
  formatFollowControl,
  formatFollowCycle,
  formatFollowInspection,
  formatFollowService,
  formatFollowStatus,
} from "./host-follow-format.js";
import { inspectFollowCycle, readFollowStatus } from "./host-follow-inspection.js";
import { abortableSleep, runFollowLoop, withFollowLock } from "./host-follow-loop.js";
import {
  applyFollowService,
  defaultHostFollowServicePorts,
  hostFollowLogPath,
  planFollowService,
  readFollowServiceConfig,
  type HostFollowServicePorts,
} from "./host-follow-service.js";
import { changeFollowControl } from "./host-follow-state.js";
import { recordedInstallRepository, repositoryUnknown } from "./host-follow-runtime.js";
import type { HostReleaseSource } from "./host-release-source.js";
import {
  createLinkedCliUpgradeRunner,
  type RepositoryUpgradeRunner,
} from "./host-repository-upgrade-runner.js";
import type { HostUpgradeDependencies } from "./host-upgrade.js";
import type { HostUpgradeLayout } from "./host-upgrade-layout.js";
import { keepServiceLogBounded } from "./service-log-bound.js";
import type { CliIo } from "./types.js";

/** Test seam for the follower's process, service, and timing effects. */
export interface HostFollowOverrides {
  listRepositories?: () => Promise<string[]>;
  runRepositoryUpgrade?: RepositoryUpgradeRunner;
  runningInstallRoot?: () => Promise<string | null>;
  servicePorts?: HostFollowServicePorts;
  random?: () => number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  log?: (line: string) => void;
  /** Receives the PATH a service configuration restores; the default sets `process.env.PATH`. */
  restoreSearchPath?: (searchPath: string) => void;
}

export interface HostFollowContext {
  homeDirectory: string;
  platform: NodeJS.Platform;
  layout: (binDirectory: string | undefined) => HostUpgradeLayout;
  upgradeDependencies: (layout: HostUpgradeLayout) => HostUpgradeDependencies;
  createSource: (repository: string) => HostReleaseSource;
  follow: HostFollowOverrides;
}

/** Cycle outcomes a `--once` run reports with exit status 1. */
const failingOutcomes = new Set<HostFollowCycleOutcome>([
  "host_blocked",
  "release_failed",
  "rolled_back",
  "rollback_failed",
]);

function serviceLoopSignal(): AbortSignal {
  const controller = new AbortController();
  for (const name of ["SIGTERM", "SIGINT"] as const) process.once(name, () => controller.abort());
  return controller.signal;
}

/** `lervo host upgrade --follow`: the ADR-0575 release follower of one host. */
export async function runHostFollowCommand(
  parsed: HostFollowArguments,
  io: CliIo,
  context: HostFollowContext,
): Promise<number> {
  const { follow } = context;
  const config = parsed.config === undefined ? null : await readFollowServiceConfig(parsed.config);
  if (parsed.config !== undefined && config === null)
    throw new CommandFailure(
      "host_follow_config_invalid",
      `${parsed.config} does not exist; reinstall the service with lervo host upgrade --follow --service install --apply.`,
    );
  if (config !== null)
    (follow.restoreSearchPath ?? ((path) => (process.env.PATH = path)))(config.searchPath);
  const layout = context.layout(parsed.binDirectory ?? config?.binDirectory);
  const repository = async () => {
    const coordinate =
      parsed.repository ?? config?.repository ?? (await recordedInstallRepository(layout));
    if (coordinate === null) throw repositoryUnknown();
    return coordinate;
  };
  const write = (operation: string, result: object, text: string) =>
    io.stdout(
      parsed.json
        ? `${JSON.stringify({ schemaVersion: 1, operation, ...result }, null, 2)}\n`
        : text,
    );
  const servicePorts = () =>
    follow.servicePorts ?? defaultHostFollowServicePorts(context.homeDirectory);
  const runningInstallRoot = follow.runningInstallRoot ?? (() => runningCliInstallRoot());
  const { mode } = parsed;

  if (mode.kind === "pause" || mode.kind === "resume" || mode.kind === "pin") {
    const control = await changeFollowControl(
      layout,
      mode,
      context.upgradeDependencies(layout).now().toISOString(),
    );
    write("host_follow_control", { control }, formatFollowControl(control));
    return 0;
  }
  if (mode.kind === "status") {
    const status = await readFollowStatus(layout, servicePorts());
    write("host_follow_status", status, formatFollowStatus(status));
    return 0;
  }
  if (mode.kind === "service") {
    const input = {
      operation: mode.operation,
      repository: mode.operation === "install" ? (parsed.repository ?? null) : null,
    };
    if (!parsed.apply) {
      const plan = await planFollowService(layout, servicePorts(), input);
      write("host_follow_service_plan", plan, formatFollowService(plan, false));
      return plan.blocker === null ? 0 : 1;
    }
    const result = await applyFollowService(layout, servicePorts(), input);
    write("host_follow_service", result, formatFollowService(result, true));
    return 0;
  }

  const source = context.createSource(await repository());
  if (!parsed.apply) {
    const inspection = await inspectFollowCycle({ layout, source, runningInstallRoot });
    write("host_follow_plan", inspection, formatFollowInspection(inspection));
    return 0;
  }
  const cycle: HostFollowCycleDependencies = {
    upgrade: context.upgradeDependencies(layout),
    source,
    listRepositories:
      follow.listRepositories ??
      (async () =>
        (await listRegisteredRepositories(defaultRepositoryRegistryPath())).map(
          (registration) => registration.repositoryRoot,
        )),
    runRepositoryUpgrade:
      follow.runRepositoryUpgrade ??
      createLinkedCliUpgradeRunner(resolve(layout.binDirectory, "lervo"), process.env),
    runningInstallRoot,
  };
  if (mode.once) {
    const result = await withFollowLock(layout, () => runFollowCycle(cycle));
    write("host_follow_cycle", result, formatFollowCycle(result));
    return failingOutcomes.has(result.outcome) ? 1 : 0;
  }
  const stopBounding =
    context.platform === "darwin" && follow.log === undefined
      ? keepServiceLogBounded(hostFollowLogPath(context.homeDirectory))
      : () => undefined;
  try {
    return await runFollowLoop({
      layout,
      runCycle: () => runFollowCycle(cycle),
      random: follow.random ?? Math.random,
      sleep: follow.sleep ?? abortableSleep,
      log: follow.log ?? ((line) => io.stdout(`${line}\n`)),
      now: () => context.upgradeDependencies(layout).now(),
      signal: follow.signal ?? serviceLoopSignal(),
    });
  } finally {
    stopBounding();
  }
}
