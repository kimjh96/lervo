import { createProcessObserver, type ProcessObservation } from "@lervo/node-work-admission";
import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { homedir } from "node:os";

// The hook bundles only these small service primitives, never the whole service manager.
// @ts-expect-error The repository service script intentionally remains plain ESM.
import { runtimeServiceTargetPath } from "../../../scripts/distribution/render-runtime-service.mjs";
import {
  launchdJobProcessId,
  launchdJobRunning,
  systemdMainProcessId,
  systemdMainProcessIdArguments,
  // @ts-expect-error The repository service script intentionally remains plain ESM.
} from "../../../scripts/distribution/lib/runtime-service-process.mjs";

import { readCurrentNodeRuntime } from "./node-runtime-pointer.js";
import { observeReplicaProcessRuntime } from "./repository-replica-process-runtime.js";
import type { TerminalLifecycleInspection } from "./terminal-hook-contract.js";

const RUNTIME = "repository-replica";
const serviceLabel = "dev.lervo.repository-replica";
const serviceUnit = "lervo-repository-replica.service";
const maximumDefinitionBytes = 128 * 1024;

type LifecycleIssue = TerminalLifecycleInspection["issues"][number];
type ServiceManager = "launchd" | "systemd";

/** The service manager's view of the coordinator, with the running process id (ADR-0573). */
export interface ReplicaServiceObservation {
  /** False when the user service manager could not be asked at all, such as without a bus. */
  managerReachable: boolean;
  loaded: boolean;
  active: boolean;
  processId: number | null;
}

function managerAnswer(
  command: string,
  args: string[],
): Promise<{ exitCode: number | null; stdout: string }> {
  return new Promise((done) => {
    execFile(
      command,
      args,
      { encoding: "utf8", maxBuffer: 65_536, timeout: 5_000 },
      (error, stdout) =>
        done({
          exitCode: error === null ? 0 : typeof error.code === "number" ? error.code : null,
          stdout,
        }),
    );
  });
}

/**
 * One manager call per inspection. launchd: `launchctl print` exits non-zero for a job that is
 * not loaded. systemd: a stopped unit reports `MainPID` 0, and loaded mirrors running there. A
 * shell without a user bus, such as a plain SSH or `su` session, cannot reach the user manager:
 * `systemctl --user` is not run without `XDG_RUNTIME_DIR` or `DBUS_SESSION_BUS_ADDRESS`, and a
 * missing or failing `systemctl` means the same.
 */
async function observeService(input: {
  manager: ServiceManager;
  uid: number | null;
  environment: NodeJS.ProcessEnv;
}): Promise<ReplicaServiceObservation> {
  if (input.manager === "systemd") {
    const unreachable = { managerReachable: false, loaded: false, active: false, processId: null };
    if (!input.environment.XDG_RUNTIME_DIR && !input.environment.DBUS_SESSION_BUS_ADDRESS)
      return unreachable;
    const answer = await managerAnswer("systemctl", systemdMainProcessIdArguments(serviceUnit));
    if (answer.exitCode !== 0) return unreachable;
    const processId = systemdMainProcessId(answer.stdout);
    return {
      managerReachable: true,
      loaded: processId !== null,
      active: processId !== null,
      processId,
    };
  }
  const answer = await managerAnswer("launchctl", ["print", `gui/${input.uid}/${serviceLabel}`]);
  const loaded = answer.exitCode === 0;
  return {
    managerReachable: true,
    loaded,
    active: loaded && launchdJobRunning(answer.stdout),
    processId: loaded ? launchdJobProcessId(answer.stdout) : null,
  };
}

/** The one replica failure code; the Stop hook labels it a lifecycle, not knowledge, failure. */
export const REPOSITORY_REPLICA_SERVICE_INSPECTION_FAILED =
  "repository_replica_service_inspection_failed";

const inspectionFailed: LifecycleIssue = {
  code: REPOSITORY_REPLICA_SERVICE_INSPECTION_FAILED,
  command: "inspect the installed repository replica service",
};

/** Issues make the turn report action required; advisories never do. */
export interface ReplicaServiceInspection {
  issues: LifecycleIssue[];
  advisories: LifecycleIssue[];
}

const reported = (issues: LifecycleIssue[]): ReplicaServiceInspection => ({
  issues,
  advisories: [],
});

/**
 * ADR-0628 and ADR-0573: an installed coordinator definition must be owner-only, stay loaded,
 * and run a process bound to the runtime `current` names. launchd and systemd hosts report the
 * same codes. A user manager this shell cannot reach is an advisory: the coordinator may run
 * fine, and this turn simply cannot see it.
 */
export async function inspectTerminalRepositoryReplicaService(
  input: {
    platform?: NodeJS.Platform;
    homeDirectory?: string;
    uid?: number;
    environment?: NodeJS.ProcessEnv;
    serviceStatus?: (input: {
      manager: ServiceManager;
      uid: number | null;
      environment: NodeJS.ProcessEnv;
    }) => Promise<ReplicaServiceObservation>;
    observeProcess?: (pid: number) => ProcessObservation;
  } = {},
): Promise<ReplicaServiceInspection> {
  const platform = input.platform ?? process.platform;
  const manager: ServiceManager | null =
    platform === "darwin" ? "launchd" : platform === "linux" ? "systemd" : null;
  if (manager === null) return reported([]);
  const homeDirectory = input.homeDirectory ?? homedir();
  const definition = runtimeServiceTargetPath(
    { manager, runtime: RUNTIME, instance: null },
    homeDirectory,
  ) as string;
  let metadata;
  try {
    metadata = await lstat(definition);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return reported([]);
    return reported([inspectionFailed]);
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > maximumDefinitionBytes ||
    (metadata.mode & 0o077) !== 0
  ) {
    return reported([
      {
        code: "repository_replica_service_definition_unsafe",
        command: "review the owner-only repository replica service definition",
      },
    ]);
  }
  const uid = input.uid ?? process.getuid?.() ?? null;
  if (manager === "launchd" && uid === null) return reported([inspectionFailed]);
  let status: ReplicaServiceObservation;
  try {
    status = await (input.serviceStatus ?? observeService)({
      manager,
      uid,
      environment: input.environment ?? process.env,
    });
  } catch {
    return reported([inspectionFailed]);
  }
  if (!status.managerReachable)
    return {
      issues: [],
      advisories: [
        {
          code: "repository_replica_service_manager_unreachable",
          command: "systemctl --user status lervo-repository-replica.service",
        },
      ],
    };
  if (!status.loaded)
    return reported([
      {
        code: "repository_replica_service_inactive",
        command:
          manager === "launchd"
            ? 'launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/dev.lervo.repository-replica.plist"'
            : "systemctl --user enable --now lervo-repository-replica.service",
      },
    ]);
  const processRuntime = await observeReplicaProcessRuntime({
    status,
    runtime: await readCurrentNodeRuntime(homeDirectory, platform),
    homeDirectory,
    platform,
    observeProcess: input.observeProcess ?? createProcessObserver(),
  });
  return reported(
    processRuntime === "stale_runtime"
      ? [{ code: "repository_replica_service_stale_runtime", command: "lervo upgrade" }]
      : [],
  );
}
