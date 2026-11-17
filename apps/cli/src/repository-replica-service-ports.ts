import { realpath } from "node:fs/promises";
import { homedir } from "node:os";

import { createProcessObserver, type ProcessObservation } from "@lervo/node-runtime";
import { defaultNodeFleetRegistryPath, listNodeFleetInstances } from "@lervo/repository-registry";

// These release-tested service primitives are bundled into the installed CLI.
// @ts-expect-error The repository service script intentionally remains plain ESM.
import { manageRuntimeService } from "../../../scripts/distribution/manage-runtime-service.mjs";

import type { ManagedServiceStatus } from "./managed-user-service-write.js";
import {
  describeInstalledNodeLauncher,
  materializeInstalledNodeLauncher,
} from "./node-fleet-runtime-material.js";
import { legacyReplicaConfigPath } from "./repository-replica-config-migration.js";

/** The host effects the ADR-0483 replica service stage plans and applies through. */
export interface RepositoryReplicaServicePorts {
  platform: NodeJS.Platform;
  homeDirectory: string;
  uid: number | null;
  environment: NodeJS.ProcessEnv;
  /** The `<hash16>` directory the runtime bundled with this CLI installs into. */
  bundledRuntime(): Promise<string>;
  materializeRuntime(): Promise<void>;
  /** The pre-ADR-0483 coordinator configuration to migrate, or null when none may be read. */
  legacyConfigPath: string | null;
  /** Whether this host runs any registered Node, which makes it a replica peer candidate. */
  hostRunsNodes(): Promise<boolean>;
  nodeExecutable(): Promise<string>;
  manage(args: string[], options: Record<string, unknown>): Promise<ManagedServiceStatus>;
  /** ADR-0573: the birth identity of a running process, which its runtime binding must match. */
  observeProcess(pid: number): ProcessObservation;
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
      return (await describeInstalledNodeLauncher(home)).hash.slice(
        "sha256:".length,
        "sha256:".length + 16,
      );
    },
    materializeRuntime: async () => {
      await materializeInstalledNodeLauncher(home);
    },
    legacyConfigPath: legacyReplicaConfigPath(home, process.env),
    hostRunsNodes: () => hostRunsNodes(process.env),
    nodeExecutable: () => realpath(process.execPath),
    manage: (args, options) => manageRuntimeService(args, options) as Promise<ManagedServiceStatus>,
    observeProcess: createProcessObserver(),
  };
}
