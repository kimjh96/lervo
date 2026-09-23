import { openDeploymentSupervision } from "./deployment-supervision.js";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import type { NodeSupervisionService } from "./supervision-startup.js";
import { createSyncCycleObserver } from "./sync-cycle-observer.js";
import { createNodeDeploymentTransports } from "./deployment-transports.js";
import { watchLocalEventChanges } from "./local-event-wakeup.js";
import { lstat } from "node:fs/promises";

import { FileSystemCas } from "@lervo/cas";
import { ConversationOperationDrain } from "@lervo/conversation-app";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { loadProjectManifest, resolveProjectPaths } from "@lervo/project";
import { openProjectStorage } from "@lervo/project-storage";
import { registerProject, runOutboundSyncLoop } from "@lervo/sync";
import {
  calculateProjectIdentityHash,
  createProjectRegistrationRequest,
} from "@lervo/sync-contract";

import type { NodeRuntimeConfig } from "./config-types.js";
import { parseNodeRuntimeConfig } from "./config.js";
import { loadNodeBearerToken, ReloadableNodeBearerToken } from "./credentials.js";
import { NodeRuntimeError } from "./errors.js";
import { createNodeRuntimeHealthPublisher } from "./health.js";
import { createNodeRuntimeDeployment, type NodeRuntimeDeployment } from "./lifecycle.js";
import { createNodeOrganizationCredentialDelivery } from "./organization-credential-delivery.js";
import { openDeploymentConversation } from "./deployment-conversation.js";
import { configuredDiscordConversations } from "./discord-conversation-deployments-config.js";
import type { NodeDiscordConversationRuntime } from "./discord-conversation-runtime.js";
import { openNodeRemoteControlRuntime, type NodeRemoteControlRuntime } from "./control-runtime.js";
import type { NodeRuntimeOpenPorts } from "./open-ports.js";
import { loadNodeRuntimeTrust, ReloadableNodeRuntimeTrust } from "./trust.js";
import { NodeWorkstreamReplicationLocalPort } from "./workstream-replication.js";
import { openNodeRuntimeWorkAdmission, type NodeRuntimeWorkAdmission } from "./work-admission.js";

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
  let conversation: NodeDiscordConversationRuntime | undefined;
  let supervision: NodeSupervisionService | null = null;
  let operationDrain = new ConversationOperationDrain();
  let workAdmission: NodeRuntimeWorkAdmission | undefined;
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
    workAdmission = await openNodeRuntimeWorkAdmission({
      repositoryRoot: validated.repositoryRoot,
      ...(ports.runtimeConfigPath === undefined ? {} : { configPath: ports.runtimeConfigPath }),
      ...(ports.runtimeConfigDigest === undefined
        ? {}
        : { configDigest: ports.runtimeConfigDigest }),
    });
    operationDrain = workAdmission.drain;
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
      configuredDiscordConversations(validated).length > 0,
      validated.outcomeSupervision !== undefined,
    );
    store = await SQLiteEventStore.open({
      path: paths.eventDatabase,
      projectId: manifest.projectId,
      writableEventSchemaVersion: preparedStorage.writableEventSchemaVersion ?? 1,
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
        operationDrain,
        ports: {
          ...ports.remoteCommands,
          onAcknowledgementPrepared: async (input) => {
            await conversation?.observeRemoteAcknowledgement(input);
            await ports.remoteCommands!.onAcknowledgementPrepared?.(input);
          },
          onCycle: async (result) => {
            await health.observeRemoteControl(result);
            await ports.remoteCommands!.onCycle?.(result);
            await conversation?.runResultDeliveryCycle();
          },
        },
        trust: runtimeTrust,
      });
    }
    const {
      transportOptions,
      createTransport,
      idleWait,
      transport,
      workstreamTransport,
      workspaceTransport,
    } = createNodeDeploymentTransports({
      config: validated,
      target,
      bearerToken: () => bearerToken.current(),
      ...(ports.createTransport === undefined ? {} : { createTransport: ports.createTransport }),
    });
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
    // Standing supervision hands successor bindings from goal intake to the owner service.
    const supervisionControl = {
      onRebound: async (_binding: NodeSupervisionBinding): Promise<void> => {
        throw new Error("Standing supervision is not running.");
      },
    };
    conversation = await openDeploymentConversation({
      supervisionControl,
      config: validated,
      project: manifest,
      projectIdentityHash: target.projectIdentityHash,
      repositoryRoot: paths.repositoryRoot,
      dataDirectory: paths.data,
      operationDrain,
      ...(ports.runtimeConfigPath === undefined
        ? {}
        : { runtimeConfigPath: ports.runtimeConfigPath }),
      bearerToken: () => bearerToken.current(),
      repositoryArtifacts: artifacts,
      repositoryEvents: store,
      legacyPorts: ports.discordConversation,
      deploymentPorts: ports.discordConversations,
      onReady: () => health.observeConversationReady(),
      onFailure: (code) => health.observeConversationFailure(code),
    });
    supervision = await openDeploymentSupervision({
      config: validated,
      projectId: manifest.projectId,
      conversation,
      health,
    });
    if (supervision !== null) {
      const service = supervision;
      supervisionControl.onRebound = (binding) => service.rebind(binding);
    }
    return createNodeRuntimeDeployment(
      store,
      async (signal) => {
        const stopWatching = watchLocalEventChanges(store!, () => idleWait.notify());
        try {
          return await runOutboundSyncLoop({
            worker,
            signal,
            ...(ports.wait === undefined
              ? { waitForIdleChange: (signal: AbortSignal) => idleWait.wait(signal) }
              : {}),
            ...(validated.sync.idlePollIntervalMs === undefined
              ? {}
              : {
                  idlePollIntervalMs: validated.sync.idlePollIntervalMs,
                }),
            ...(ports.wait === undefined ? {} : { wait: ports.wait }),
            ...(ports.nowMilliseconds === undefined
              ? {}
              : { nowMilliseconds: ports.nowMilliseconds }),
            onCycle: createSyncCycleObserver({
              health,
              workstreams: () => ({
                local: localWorkstreams,
                transport: workstreamTransport,
                registration: createProjectRegistrationRequest({
                  manifest,
                  destinationId: validated.hub.destinationId,
                  requestedAt: new Date().toISOString(),
                }),
                destinationId: validated.hub.destinationId,
                expectedPeerIdentityHash: validated.hub.hubIdentityHash,
              }),
              ...(validated.workspaceCoordination === undefined
                ? {}
                : {
                    workspaces: {
                      repositoryRoot: paths.repositoryRoot,
                      nodeId: validated.workspaceCoordination.nodeId,
                      repositoryIdentityHash: target.projectIdentityHash,
                      transport: workspaceTransport,
                    },
                  }),
              ...(ports.onCycle === undefined ? {} : { onCycle: ports.onCycle }),
            }),
          });
        } finally {
          stopWatching();
        }
      },
      remoteControl ?? null,
      conversation ?? null,
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
      supervision,
      operationDrain,
      () => workAdmission?.close(),
    );
  } catch (error) {
    operationDrain.stop();
    const cleanupErrors: unknown[] = [];
    try {
      await supervision?.close();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    try {
      await conversation?.close();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    try {
      workAdmission?.close();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
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
