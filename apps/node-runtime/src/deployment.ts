import { lstat } from "node:fs/promises";

import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { loadProjectManifest, resolveProjectPaths } from "@lervo/project";
import {
  AuthenticatedHubHttpTransport,
  runOutboundSyncLoop,
  type AuthenticatedHubTransport,
  type OutboundSyncPollingWaitPort,
  type SyncCycleResult,
  type SyncHttpTransportOptions,
} from "@lervo/sync";
import { calculateProjectIdentityHash } from "@lervo/sync-contract";

import type { NodeRuntimeConfig } from "./config-types.js";
import { parseNodeRuntimeConfig } from "./config.js";
import { loadNodeBearerToken, ReloadableNodeBearerToken } from "./credentials.js";
import { NodeRuntimeError } from "./errors.js";
import { createNodeRuntimeHealthPublisher } from "./health.js";
import {
  createNodeRuntimeDeployment,
  type NodeRuntimeDeployment,
} from "./lifecycle.js";
import {
  openNodeRemoteControlRuntime,
  type NodeRemoteCommandPorts,
  type NodeRemoteControlRuntime,
} from "./control-runtime.js";
import { loadNodeRuntimeTrust, ReloadableNodeRuntimeTrust } from "./trust.js";

export interface NodeRuntimeOpenPorts {
  createTransport?: (options: SyncHttpTransportOptions) => AuthenticatedHubTransport;
  wait?: OutboundSyncPollingWaitPort;
  nowMilliseconds?: () => number;
  onCycle?: (result: SyncCycleResult) => void | Promise<void>;
  remoteCommands?: NodeRemoteCommandPorts;
}

async function assertRepositoryRoot(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("unsafe root");
  } catch (error) {
    throw new NodeRuntimeError(
      "project_invalid",
      "The Node runtime repository root must be an initialized physical directory.",
      { cause: error },
    );
  }
}

export async function openNodeRuntime(
  config: NodeRuntimeConfig,
  ports: NodeRuntimeOpenPorts = {},
): Promise<NodeRuntimeDeployment> {
  let store: SQLiteEventStore | undefined;
  let remoteControl: NodeRemoteControlRuntime | undefined;
  let runtimeTrust: ReloadableNodeRuntimeTrust | undefined;
  try {
    const validated = parseNodeRuntimeConfig(config, process.cwd());
    await assertRepositoryRoot(validated.repositoryRoot);
    const paths = resolveProjectPaths(validated.repositoryRoot);
    const manifest = await loadProjectManifest(validated.repositoryRoot);
    if (!manifest.dataPolicy.hubSyncEnabled) {
      throw new NodeRuntimeError(
        "project_invalid",
        "Hub sync is not enabled by the project data policy.",
      );
    }
    const bearerToken = new ReloadableNodeBearerToken(
      await loadNodeBearerToken(validated.hub.bearerTokenFile),
    );
    const health = createNodeRuntimeHealthPublisher(
      paths.state,
      validated.remoteCommands !== undefined,
    );
    store = await SQLiteEventStore.open({ path: paths.eventDatabase, projectId: manifest.projectId });
    const target = {
      projectId: manifest.projectId,
      projectIdentityHash: calculateProjectIdentityHash(manifest),
    };
    if ((validated.remoteCommands === undefined) !== (ports.remoteCommands === undefined)) {
      throw new NodeRuntimeError(
        "invalid_config",
        "Remote-control configuration, executor, and local-policy ports must be provided together.",
      );
    }
    if (validated.remoteCommands !== undefined && ports.remoteCommands !== undefined) {
      runtimeTrust = new ReloadableNodeRuntimeTrust(
        await loadNodeRuntimeTrust(validated.remoteCommands),
        target,
      );
      remoteControl = await openNodeRemoteControlRuntime({
        config: validated,
        token: () => bearerToken.current(),
        target,
        stateDirectory: paths.state,
        ports: {
          ...ports.remoteCommands,
          onCycle: async (result) => {
            await health.observeRemoteControl(result);
            await ports.remoteCommands!.onCycle?.(result);
          },
        },
        trust: runtimeTrust,
      });
    }
    const transportOptions = (): SyncHttpTransportOptions => ({
      baseUrl: validated.hub.baseUrl,
      bearerToken: bearerToken.current(),
      expectedHubIdentityHash: validated.hub.hubIdentityHash,
      destinationId: validated.hub.destinationId,
      target,
      ...(validated.sync.requestTimeoutMs === undefined ? {} : {
        requestTimeoutMs: validated.sync.requestTimeoutMs,
      }),
      ...(validated.sync.maxRequestBytes === undefined ? {} : {
        maxRequestBytes: validated.sync.maxRequestBytes,
      }),
      ...(validated.sync.maxResponseBytes === undefined ? {} : {
        maxResponseBytes: validated.sync.maxResponseBytes,
      }),
    });
    const createTransport = ports.createTransport ?? ((options) =>
      new AuthenticatedHubHttpTransport(options));
    const transport: AuthenticatedHubTransport = {
      registerProject(request) {
        return createTransport(transportOptions()).registerProject(request);
      },
      sendEventBatch(batch) {
        return createTransport(transportOptions()).sendEventBatch(batch);
      },
    };
    const worker = {
      store,
      transport,
      manifest,
      destinationId: validated.hub.destinationId,
      expectedPeerIdentityHash: validated.hub.hubIdentityHash,
      workerId: validated.sync.workerId,
      ...(validated.sync.leaseDurationMs === undefined ? {} : {
        leaseDurationMs: validated.sync.leaseDurationMs,
      }),
      ...(validated.sync.retryDelayMs === undefined ? {} : {
        retryDelayMs: validated.sync.retryDelayMs,
      }),
      ...(validated.sync.batchLimit === undefined ? {} : {
        batchLimit: validated.sync.batchLimit,
      }),
    };
    await health.initialize();
    return createNodeRuntimeDeployment(store, (signal) => runOutboundSyncLoop({
      worker,
      signal,
      ...(validated.sync.idlePollIntervalMs === undefined ? {} : {
        idlePollIntervalMs: validated.sync.idlePollIntervalMs,
      }),
      ...(ports.wait === undefined ? {} : { wait: ports.wait }),
      ...(ports.nowMilliseconds === undefined ? {} : { nowMilliseconds: ports.nowMilliseconds }),
      onCycle: async (result) => {
        await health.observeSync(result);
        await ports.onCycle?.(result);
      },
    }), remoteControl ?? null, async () => {
      const next = await loadNodeBearerToken(validated.hub.bearerTokenFile);
      bearerToken.replace(next);
    }, async () => {
      const [nextToken, nextTrust] = await Promise.all([
        loadNodeBearerToken(validated.hub.bearerTokenFile),
        validated.remoteCommands === undefined
          ? Promise.resolve(undefined)
          : loadNodeRuntimeTrust(validated.remoteCommands),
      ]);
      if (nextTrust !== undefined) {
        runtimeTrust!.replace(nextTrust);
      }
      bearerToken.replace(nextToken);
    }, health);
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    try {
      remoteControl?.close();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    try {
      store?.close();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (cleanupErrors.length > 0) {
      throw new NodeRuntimeError("startup_failed", "Could not close the repository after Node runtime startup failed.", {
        cause: new AggregateError([error, ...cleanupErrors]),
      });
    }
    if (error instanceof NodeRuntimeError) throw error;
    throw new NodeRuntimeError("startup_failed", "Could not open the Node runtime configuration.", {
      cause: error,
    });
  }
}
