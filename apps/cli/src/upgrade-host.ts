import { terminalHookRuntimeStorePath } from "@lervo/repository-knowledge";

import {
  eventWriterStagePortsForHookStore,
  type EventWriterStagePorts,
} from "./event-writer-activation-stage.js";
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
 * Where the upgrade's host-wide stages look: the user home that holds Node runtimes, user
 * services, and the terminal hook runtime, and the host process listing that protects runtimes
 * in use. Absent, the live host.
 */
export interface UpgradeHostOptions {
  homeDirectory: string;
  processCommands?: () => Promise<string>;
}

/** The ports the host-wide stages and the event writer's hook reader plan and apply with. */
export interface UpgradeHost {
  runtimeRetention: RuntimeRetentionOptions;
  /** Absent: each stage uses its own live-host defaults. */
  hostService?: KnowledgeHostServicePorts;
  replicaService?: RepositoryReplicaServicePorts;
  eventWriter?: EventWriterStagePorts;
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
    eventWriter: eventWriterStagePortsForHookStore(
      terminalHookRuntimeStorePath(process.env, process.platform, options.homeDirectory),
    ),
  };
}
