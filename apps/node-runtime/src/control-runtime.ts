import { resolve } from "node:path";

import {
  AuthenticatedPolicyHttpTransport,
  PolicyBackedRemoteCommandPolicy,
  PolicyManagedRunApprovalVerifier,
  runPolicySyncCycle,
  type AuthenticatedPolicyHubTransport,
  type LocalCommandCapabilityPolicy,
  type ManagedRunApprovalVerifier,
  type PolicyHttpTransportOptions,
} from "@lervo/policy";
import { SQLitePolicyStateStore } from "@lervo/policy-sqlite";
import {
  AuthenticatedRemoteCommandHttpPayloadLoader,
  AuthenticatedRemoteCommandHttpTransport,
  RemoteCommandReceiver,
  runRemoteCommandReconnectCycle,
  type AuthenticatedRemoteCommandHubTransport,
  type RemoteCommandClock,
  type RemoteCommandExecutor,
  type RemoteCommandHttpPayloadLoaderOptions,
  type RemoteCommandHttpTransportOptions,
  type RemoteCommandPayloadLoader,
  type RemoteCommandPollingWaitPort,
} from "@lervo/remote-command";
import { SQLiteRemoteCommandReplayStore } from "@lervo/remote-command-sqlite";
import { type RemoteCommandTarget } from "@lervo/schemas";

import {
  runRemoteControlLoop,
  type RemoteControlCycleResult,
  type RemoteControlLoopResult,
} from "./control-loop.js";
import { type NodeRuntimeConfig } from "./config-types.js";
import { NodeRuntimeError } from "./errors.js";
import { loadNodeRuntimeTrust, ReloadableNodeRuntimeTrust } from "./trust.js";

export interface NodeRemoteCommandPorts {
  executor?: RemoteCommandExecutor;
  createExecutor?: (input: {
    target: RemoteCommandTarget;
    approvalVerifier: ManagedRunApprovalVerifier;
  }) => RemoteCommandExecutor;
  localPolicy: LocalCommandCapabilityPolicy;
  createPolicyTransport?: (options: PolicyHttpTransportOptions) => AuthenticatedPolicyHubTransport;
  createCommandTransport?: (
    options: RemoteCommandHttpTransportOptions,
  ) => AuthenticatedRemoteCommandHubTransport;
  createPayloadLoader?: (
    options: RemoteCommandHttpPayloadLoaderOptions,
  ) => RemoteCommandPayloadLoader;
  wait?: RemoteCommandPollingWaitPort;
  clock?: RemoteCommandClock;
  nowMilliseconds?: () => number;
  onCycle?: (result: RemoteControlCycleResult) => void | Promise<void>;
  onAcknowledgementPrepared?: NonNullable<
    Parameters<typeof runRemoteCommandReconnectCycle>[0]["onAcknowledgementPrepared"]
  >;
}

export interface NodeRemoteControlRuntime {
  run(signal: AbortSignal): Promise<RemoteControlLoopResult>;
  close(): void;
}

function httpOptions(input: {
  config: NodeRuntimeConfig;
  token: string;
  target: RemoteCommandTarget;
}) {
  const commands = input.config.remoteCommands!;
  return {
    baseUrl: input.config.hub.baseUrl,
    bearerToken: input.token,
    expectedHubIdentityHash: input.config.hub.hubIdentityHash,
    destinationId: input.config.hub.destinationId,
    nodeId: commands.nodeId,
    target: structuredClone(input.target),
    ...(commands.requestTimeoutMs === undefined
      ? {}
      : {
          requestTimeoutMs: commands.requestTimeoutMs,
        }),
  };
}

export async function openNodeRemoteControlRuntime(input: {
  config: NodeRuntimeConfig;
  token: () => string;
  target: RemoteCommandTarget;
  stateDirectory: string;
  ports: NodeRemoteCommandPorts;
  trust?: ReloadableNodeRuntimeTrust;
}): Promise<NodeRemoteControlRuntime> {
  const commands = input.config.remoteCommands;
  if (commands === undefined) {
    throw new NodeRuntimeError("invalid_config", "No remote-control configuration was provided.");
  }
  let policyStore: SQLitePolicyStateStore | undefined;
  let replayStore: SQLiteRemoteCommandReplayStore | undefined;
  try {
    const trust =
      input.trust ??
      new ReloadableNodeRuntimeTrust(await loadNodeRuntimeTrust(commands), input.target);
    const commandTrust = trust.commandTrustStore;
    const policyTrust = trust.policyTrustStore;
    policyStore = await SQLitePolicyStateStore.open({
      path: resolve(input.stateDirectory, "policy.sqlite"),
      target: input.target,
    });
    replayStore = await SQLiteRemoteCommandReplayStore.open({
      path: resolve(input.stateDirectory, "remote-command-replay.sqlite"),
      target: input.target,
    });
    if ((input.ports.executor === undefined) === (input.ports.createExecutor === undefined)) {
      throw new NodeRuntimeError(
        "invalid_config",
        "Exactly one remote-control executor or managed executor factory is required.",
      );
    }
    const approvalVerifier = new PolicyManagedRunApprovalVerifier({
      store: policyStore,
      trustStore: policyTrust,
    });
    const executor =
      input.ports.executor ??
      input.ports.createExecutor!({
        target: structuredClone(input.target),
        approvalVerifier,
      });
    const createPolicyTransport =
      input.ports.createPolicyTransport ??
      ((options) => new AuthenticatedPolicyHttpTransport(options));
    const createCommandTransport =
      input.ports.createCommandTransport ??
      ((options) => new AuthenticatedRemoteCommandHttpTransport(options));
    const createPayloadLoader =
      input.ports.createPayloadLoader ??
      ((options) => new AuthenticatedRemoteCommandHttpPayloadLoader(options));
    const currentHttp = () => httpOptions({ ...input, token: input.token() });
    const policyTransport: AuthenticatedPolicyHubTransport = {
      pullPolicyBundle(request) {
        const commonHttp = currentHttp();
        return createPolicyTransport({
          baseUrl: commonHttp.baseUrl,
          bearerToken: commonHttp.bearerToken,
          expectedHubIdentityHash: commonHttp.expectedHubIdentityHash,
          ...(commands.requestTimeoutMs === undefined
            ? {}
            : {
                requestTimeoutMs: commands.requestTimeoutMs,
              }),
          ...(commands.maxResponseBytes === undefined
            ? {}
            : {
                maxResponseBytes: commands.maxResponseBytes,
              }),
        }).pullPolicyBundle(request);
      },
    };
    const commandTransport: AuthenticatedRemoteCommandHubTransport = {
      pullRemoteCommands(request) {
        return createCommandTransport({
          ...currentHttp(),
          ...(commands.maxResponseBytes === undefined
            ? {}
            : {
                maxResponseBytes: commands.maxResponseBytes,
              }),
        }).pullRemoteCommands(request);
      },
      acknowledgeRemoteCommand(acknowledgement) {
        return createCommandTransport({
          ...currentHttp(),
          ...(commands.maxResponseBytes === undefined
            ? {}
            : {
                maxResponseBytes: commands.maxResponseBytes,
              }),
        }).acknowledgeRemoteCommand(acknowledgement);
      },
    };
    const payloadLoader: RemoteCommandPayloadLoader = {
      load(reference) {
        return createPayloadLoader(currentHttp()).load(reference);
      },
    };
    const clock = input.ports.clock ?? { now: () => new Date().toISOString() };
    const receiver = new RemoteCommandReceiver({
      target: input.target,
      trustStore: commandTrust,
      replayStore,
      policy: new PolicyBackedRemoteCommandPolicy({
        store: policyStore,
        trustStore: policyTrust,
        localPolicy: input.ports.localPolicy,
      }),
      payloadLoader,
      executor,
      clock,
      ...(commands.maxLifetimeMs === undefined ? {} : { maxLifetimeMs: commands.maxLifetimeMs }),
      ...(commands.clockSkewMs === undefined ? {} : { clockSkewMs: commands.clockSkewMs }),
    });
    const openedPolicyStore = policyStore;
    const openedReplayStore = replayStore;
    return {
      run: (signal) =>
        runRemoteControlLoop({
          signal,
          runPolicyCycle: () =>
            runPolicySyncCycle({
              destinationId: input.config.hub.destinationId,
              expectedPeerIdentityHash: input.config.hub.hubIdentityHash,
              target: input.target,
              transport: policyTransport,
              trustStore: policyTrust,
              store: openedPolicyStore,
              clock,
            }),
          runCommandCycle: () =>
            runRemoteCommandReconnectCycle({
              destinationId: input.config.hub.destinationId,
              expectedPeerIdentityHash: input.config.hub.hubIdentityHash,
              nodeId: commands.nodeId,
              target: input.target,
              transport: commandTransport,
              handler: receiver,
              clock,
              ...(commands.leaseDurationMs === undefined
                ? {}
                : { leaseDurationMs: commands.leaseDurationMs }),
              ...(commands.retryDelayMs === undefined
                ? {}
                : { retryDelayMs: commands.retryDelayMs }),
              ...(commands.limit === undefined ? {} : { limit: commands.limit }),
              ...(input.ports.onAcknowledgementPrepared === undefined
                ? {}
                : { onAcknowledgementPrepared: input.ports.onAcknowledgementPrepared }),
            }),
          ...(commands.idlePollIntervalMs === undefined
            ? {}
            : {
                idlePollIntervalMs: commands.idlePollIntervalMs,
              }),
          ...(commands.retryDelayMs === undefined ? {} : { retryDelayMs: commands.retryDelayMs }),
          ...(input.ports.wait === undefined ? {} : { wait: input.ports.wait }),
          ...(input.ports.nowMilliseconds === undefined
            ? {}
            : {
                nowMilliseconds: input.ports.nowMilliseconds,
              }),
          ...(input.ports.onCycle === undefined ? {} : { onCycle: input.ports.onCycle }),
        }),
      close() {
        const errors: unknown[] = [];
        try {
          openedReplayStore.close();
        } catch (error) {
          errors.push(error);
        }
        try {
          openedPolicyStore.close();
        } catch (error) {
          errors.push(error);
        }
        if (errors.length > 0) throw new AggregateError(errors);
      },
    };
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    try {
      replayStore?.close();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    try {
      policyStore?.close();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (cleanupErrors.length > 0) {
      throw new NodeRuntimeError(
        "startup_failed",
        "Could not close the repository after remote-control startup failed.",
        {
          cause: new AggregateError([error, ...cleanupErrors]),
        },
      );
    }
    if (error instanceof NodeRuntimeError) throw error;
    throw new NodeRuntimeError("startup_failed", "Could not open the remote-control runtime.", {
      cause: error,
    });
  }
}
