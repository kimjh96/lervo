import { lstat } from "node:fs/promises";

import { FileSystemCas } from "@lervo/cas";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { loadProjectManifest, resolveProjectPaths } from "@lervo/project";
import { openProjectStorage } from "@lervo/project-storage";
import {
  AuthenticatedHubHttpTransport,
  registerProject,
  runOutboundSyncLoop,
  runWorkstreamReplicationCycle,
  type AuthenticatedHubTransport,
  type AuthenticatedWorkstreamHubTransport,
  type OutboundSyncPollingWaitPort,
  type SyncCycleResult,
  type SyncHttpTransportOptions,
} from "@lervo/sync";
import {
  calculateProjectIdentityHash,
  createProjectRegistrationRequest,
} from "@lervo/sync-contract";
import {
  reconcileHubWorkspaceSummaries,
  type HubWorkspaceSummaryTransport,
} from "@lervo/workspace-reservation-hub";

import type { NodeRuntimeConfig } from "./config-types.js";
import { parseNodeRuntimeConfig } from "./config.js";
import { loadNodeBearerToken, ReloadableNodeBearerToken } from "./credentials.js";
import { NodeRuntimeError } from "./errors.js";
import { createNodeRuntimeHealthPublisher } from "./health.js";
import { createNodeRuntimeDeployment, type NodeRuntimeDeployment } from "./lifecycle.js";
import { createNodeOrganizationCredentialDelivery } from "./organization-credential-delivery.js";
import {
  openNodeRemoteControlRuntime,
  type NodeRemoteCommandPorts,
  type NodeRemoteControlRuntime,
} from "./control-runtime.js";
import { loadNodeRuntimeTrust, ReloadableNodeRuntimeTrust } from "./trust.js";
import { NodeWorkstreamReplicationLocalPort } from "./workstream-replication.js";

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
    const preparedStorage = await openProjectStorage(validated.repositoryRoot);
    await preparedStorage.close();
    const bearerToken = new ReloadableNodeBearerToken(
      await loadNodeBearerToken(validated.hub.bearerTokenFile),
    );
    const health = createNodeRuntimeHealthPublisher(
      paths.state,
      validated.remoteCommands !== undefined,
      validated.workspaceCoordination !== undefined,
      {
        projectId: manifest.projectId,
        repositoryIdentityHash: calculateProjectIdentityHash(manifest),
        destinationId: validated.hub.destinationId,
      },
    );
    store = await SQLiteEventStore.open({
      path: paths.eventDatabase,
      projectId: manifest.projectId,
    });
    const artifacts = await FileSystemCas.open(paths.cas);
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
        stateDirectory: paths.data,
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
      ...(validated.sync.requestTimeoutMs === undefined
        ? {}
        : {
            requestTimeoutMs: validated.sync.requestTimeoutMs,
          }),
      ...(validated.sync.maxRequestBytes === undefined
        ? {}
        : {
            maxRequestBytes: validated.sync.maxRequestBytes,
          }),
      ...(validated.sync.maxResponseBytes === undefined
        ? {}
        : {
            maxResponseBytes: validated.sync.maxResponseBytes,
          }),
    });
    const createTransport =
      ports.createTransport ?? ((options) => new AuthenticatedHubHttpTransport(options));
    const transport: AuthenticatedHubTransport = {
      registerProject(request) {
        return createTransport(transportOptions()).registerProject(request);
      },
      sendEventBatch(batch) {
        return createTransport(transportOptions()).sendEventBatch(batch);
      },
    };
    const workstreamTransport: AuthenticatedWorkstreamHubTransport = {
      publishWorkstream(request) {
        const candidate = createTransport(transportOptions()) as AuthenticatedHubTransport &
          Partial<AuthenticatedWorkstreamHubTransport>;
        if (typeof candidate.publishWorkstream !== "function") {
          throw new Error("The configured Hub transport does not support workstream publication.");
        }
        return candidate.publishWorkstream(request);
      },
      readWorkstream() {
        const candidate = createTransport(transportOptions()) as AuthenticatedHubTransport &
          Partial<AuthenticatedWorkstreamHubTransport>;
        if (typeof candidate.readWorkstream !== "function") {
          throw new Error("The configured Hub transport does not support workstream reads.");
        }
        return candidate.readWorkstream();
      },
    };
    const workspaceTransport: HubWorkspaceSummaryTransport = {
      publishWorkspaceSummary(summary) {
        const candidate = createTransport(transportOptions()) as AuthenticatedHubTransport &
          Partial<HubWorkspaceSummaryTransport>;
        if (typeof candidate.publishWorkspaceSummary !== "function")
          throw new Error("The configured Hub transport does not support workspace summaries.");
        return candidate.publishWorkspaceSummary(summary);
      },
      readWorkspaceSummaries() {
        const candidate = createTransport(transportOptions()) as AuthenticatedHubTransport &
          Partial<HubWorkspaceSummaryTransport>;
        if (typeof candidate.readWorkspaceSummaries !== "function")
          throw new Error("The configured Hub transport does not support workspace summaries.");
        return candidate.readWorkspaceSummaries();
      },
    };
    const localWorkstreams = new NodeWorkstreamReplicationLocalPort(
      paths.repositoryRoot,
      manifest.projectId,
      store,
      artifacts,
    );
    const worker = {
      store,
      transport,
      manifest,
      destinationId: validated.hub.destinationId,
      expectedPeerIdentityHash: validated.hub.hubIdentityHash,
      workerId: validated.sync.workerId,
      ...(validated.sync.leaseDurationMs === undefined
        ? {}
        : {
            leaseDurationMs: validated.sync.leaseDurationMs,
          }),
      ...(validated.sync.retryDelayMs === undefined
        ? {}
        : {
            retryDelayMs: validated.sync.retryDelayMs,
          }),
      ...(validated.sync.batchLimit === undefined
        ? {}
        : {
            batchLimit: validated.sync.batchLimit,
          }),
    };
    await health.initialize();
    return createNodeRuntimeDeployment(
      store,
      (signal) =>
        runOutboundSyncLoop({
          worker,
          signal,
          ...(validated.sync.idlePollIntervalMs === undefined
            ? {}
            : {
                idlePollIntervalMs: validated.sync.idlePollIntervalMs,
              }),
          ...(ports.wait === undefined ? {} : { wait: ports.wait }),
          ...(ports.nowMilliseconds === undefined
            ? {}
            : { nowMilliseconds: ports.nowMilliseconds }),
          onCycle: async (result) => {
            await health.observeSync(result);
            if (result.status === "idle" || result.status === "synchronized") {
              try {
                const replication = await runWorkstreamReplicationCycle({
                  local: localWorkstreams,
                  transport: workstreamTransport,
                  registration: createProjectRegistrationRequest({
                    manifest,
                    destinationId: validated.hub.destinationId,
                    requestedAt: new Date().toISOString(),
                  }),
                  destinationId: validated.hub.destinationId,
                  expectedPeerIdentityHash: validated.hub.hubIdentityHash,
                });
                await health.observeWorkstreamReplication(replication);
              } catch (error) {
                const code =
                  typeof error === "object" &&
                  error !== null &&
                  "code" in error &&
                  typeof error.code === "string"
                    ? error.code
                    : "workstream_replication_failed";
                await health.observeWorkstreamReplicationFailure(code);
              }
              if (validated.workspaceCoordination !== undefined) {
                try {
                  await reconcileHubWorkspaceSummaries({
                    repositoryRoot: paths.repositoryRoot,
                    nodeId: validated.workspaceCoordination.nodeId,
                    repositoryIdentityHash: target.projectIdentityHash,
                    transport: workspaceTransport,
                  });
                  await health.observeWorkspaceCoordination();
                } catch (error) {
                  const code =
                    typeof error === "object" &&
                    error !== null &&
                    "code" in error &&
                    typeof error.code === "string"
                      ? error.code
                      : "workspace_coordination_failed";
                  await health.observeWorkspaceCoordinationFailure(code);
                }
              }
            } else {
              await health.observeWorkstreamReplicationFailure(result.failureCode);
              if (validated.workspaceCoordination !== undefined)
                await health.observeWorkspaceCoordinationFailure(result.failureCode);
            }
            await ports.onCycle?.(result);
          },
        }),
      remoteControl ?? null,
      async () => {
        const next = await loadNodeBearerToken(validated.hub.bearerTokenFile);
        bearerToken.replace(next);
      },
      async () => {
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
      },
      health,
      validated.organizationCredentials === undefined
        ? null
        : createNodeOrganizationCredentialDelivery({
            binding: {
              nodeId: validated.organizationCredentials.nodeId,
              destinationId: validated.hub.destinationId,
              target,
              bearerTokenFile: validated.hub.bearerTokenFile,
            },
            bearerToken,
            async authenticateCandidate(candidate, requestedAt) {
              await registerProject({
                options: {
                  ...worker,
                  transport: createTransport({
                    ...transportOptions(),
                    bearerToken: candidate,
                  }),
                },
                requestedAt,
              });
            },
          }),
    );
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
      throw new NodeRuntimeError(
        "startup_failed",
        "Could not close the repository after Node runtime startup failed.",
        {
          cause: new AggregateError([error, ...cleanupErrors]),
        },
      );
    }
    if (error instanceof NodeRuntimeError) throw error;
    throw new NodeRuntimeError("startup_failed", "Could not open the Node runtime configuration.", {
      cause: error,
    });
  }
}
