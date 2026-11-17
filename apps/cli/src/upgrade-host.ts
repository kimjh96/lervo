import {
  defaultKnowledgeHostServicePorts,
  type KnowledgeHostServicePorts,
} from "./knowledge-host-service.js";
import type { RuntimeRetentionOptions } from "./node-runtime-retention.js";
import {
  defaultRepositoryReplicaServicePorts,
  type RepositoryReplicaServicePorts,
} from "./repository-replica-service.js";

/**
 * Where the upgrade's host-wide stages look: the user home that holds Node runtimes and user
 * services, and the host process listing that protects runtimes in use. Absent, the live host.
 */
export interface UpgradeHostOptions {
  homeDirectory: string;
  processCommands?: () => Promise<string>;
}

/** The ports the runtime-retention, host-service, and replica-service stages plan and apply with. */
export interface UpgradeHost {
  runtimeRetention: RuntimeRetentionOptions;
  /** Absent: each stage uses its own live-host defaults. */
  hostService?: KnowledgeHostServicePorts;
  replicaService?: RepositoryReplicaServicePorts;
}

export function upgradeHost(options?: UpgradeHostOptions): UpgradeHost {
  if (options === undefined) return { runtimeRetention: {} };
  return {
    runtimeRetention: {
      homeDirectory: options.homeDirectory,
      ...(options.processCommands === undefined
        ? {}
        : { processCommands: options.processCommands }),
    },
    hostService: defaultKnowledgeHostServicePorts(options.homeDirectory),
    replicaService: defaultRepositoryReplicaServicePorts(options.homeDirectory),
  };
}
