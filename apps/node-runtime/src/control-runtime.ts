import { createPublicKey } from "node:crypto";
import { resolve } from "node:path";

import {
  AuthenticatedPolicyHttpTransport,
  ConfiguredEd25519PolicyTrustStore,
  PolicyBackedRemoteCommandPolicy,
  runPolicySyncCycle,
  type AuthenticatedPolicyHubTransport,
  type LocalCommandCapabilityPolicy,
  type PolicyHttpTransportOptions,
} from "@lervo/policy";
import { SQLitePolicyStateStore } from "@lervo/policy-sqlite";
import {
  AuthenticatedRemoteCommandHttpPayloadLoader,
  AuthenticatedRemoteCommandHttpTransport,
  ConfiguredEd25519RemoteCommandTrustStore,
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
import { readOwnerOnlyText, RuntimeSecurityError } from "@lervo/runtime-security";
import { type RemoteCommandTarget } from "@lervo/schemas";

import { runRemoteControlLoop, type RemoteControlCycleResult, type RemoteControlLoopResult } from "./control-loop.js";
import { type NodeRuntimeConfig } from "./config-types.js";
import { NodeRuntimeError } from "./errors.js";

const MAX_PUBLIC_KEY_BYTES = 65_536;

export interface NodeRemoteCommandPorts {
  executor: RemoteCommandExecutor;
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
}

export interface NodeRemoteControlRuntime {
  run(signal: AbortSignal): Promise<RemoteControlLoopResult>;
  close(): void;
}

async function publicKey(path: string) {
  let serialized: string;
  try {
    serialized = await readOwnerOnlyText(path, MAX_PUBLIC_KEY_BYTES);
  } catch (error) {
    const code = error instanceof RuntimeSecurityError && error.code === "invalid_text"
      ? "invalid_config"
      : "unsafe_runtime_file";
    throw new NodeRuntimeError(code, "원격 제어 public key 파일을 안전하게 읽지 못했습니다.", {
      cause: error,
    });
  }
  try {
    return createPublicKey(serialized);
  } catch (error) {
    throw new NodeRuntimeError("invalid_config", "원격 제어 public key가 유효하지 않습니다.", {
      cause: error,
    });
  }
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
    ...(commands.requestTimeoutMs === undefined ? {} : {
      requestTimeoutMs: commands.requestTimeoutMs,
    }),
  };
}

export async function openNodeRemoteControlRuntime(input: {
  config: NodeRuntimeConfig;
  token: string;
  target: RemoteCommandTarget;
  stateDirectory: string;
  ports: NodeRemoteCommandPorts;
}): Promise<NodeRemoteControlRuntime> {
  const commands = input.config.remoteCommands;
  if (commands === undefined) {
    throw new NodeRuntimeError("invalid_config", "원격 제어 구성이 없습니다.");
  }
  let policyStore: SQLitePolicyStateStore | undefined;
  let replayStore: SQLiteRemoteCommandReplayStore | undefined;
  try {
    const [commandKeys, policyKeys] = await Promise.all([
      Promise.all(commands.commandKeys.map(async (key) => ({
        keyId: key.keyId,
        publicKey: await publicKey(key.publicKeyFile),
        projects: [structuredClone(input.target)],
      }))),
      Promise.all(commands.policyKeys.map(async (key) => ({
        keyId: key.keyId,
        publicKey: await publicKey(key.publicKeyFile),
        projects: [structuredClone(input.target)],
        purposes: [...key.purposes],
      }))),
    ]);
    const commandTrust = new ConfiguredEd25519RemoteCommandTrustStore(commandKeys);
    const policyTrust = new ConfiguredEd25519PolicyTrustStore(policyKeys);
    policyStore = await SQLitePolicyStateStore.open({
      path: resolve(input.stateDirectory, "policy.sqlite"),
      target: input.target,
    });
    replayStore = await SQLiteRemoteCommandReplayStore.open({
      path: resolve(input.stateDirectory, "remote-command-replay.sqlite"),
      target: input.target,
    });
    const commonHttp = httpOptions(input);
    const policyTransport = (input.ports.createPolicyTransport ?? ((options) =>
      new AuthenticatedPolicyHttpTransport(options)))({
      baseUrl: commonHttp.baseUrl,
      bearerToken: commonHttp.bearerToken,
      expectedHubIdentityHash: commonHttp.expectedHubIdentityHash,
      ...(commands.requestTimeoutMs === undefined ? {} : {
        requestTimeoutMs: commands.requestTimeoutMs,
      }),
      ...(commands.maxResponseBytes === undefined ? {} : {
        maxResponseBytes: commands.maxResponseBytes,
      }),
    });
    const commandTransport = (input.ports.createCommandTransport ?? ((options) =>
      new AuthenticatedRemoteCommandHttpTransport(options)))({
      ...commonHttp,
      ...(commands.maxResponseBytes === undefined ? {} : {
        maxResponseBytes: commands.maxResponseBytes,
      }),
    });
    const payloadLoader = (input.ports.createPayloadLoader ?? ((options) =>
      new AuthenticatedRemoteCommandHttpPayloadLoader(options)))(commonHttp);
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
      executor: input.ports.executor,
      clock,
      ...(commands.maxLifetimeMs === undefined ? {} : { maxLifetimeMs: commands.maxLifetimeMs }),
      ...(commands.clockSkewMs === undefined ? {} : { clockSkewMs: commands.clockSkewMs }),
    });
    const openedPolicyStore = policyStore;
    const openedReplayStore = replayStore;
    return {
      run: (signal) => runRemoteControlLoop({
        signal,
        runPolicyCycle: () => runPolicySyncCycle({
          destinationId: input.config.hub.destinationId,
          expectedPeerIdentityHash: input.config.hub.hubIdentityHash,
          target: input.target,
          transport: policyTransport,
          trustStore: policyTrust,
          store: openedPolicyStore,
          clock,
        }),
        runCommandCycle: () => runRemoteCommandReconnectCycle({
          destinationId: input.config.hub.destinationId,
          expectedPeerIdentityHash: input.config.hub.hubIdentityHash,
          nodeId: commands.nodeId,
          target: input.target,
          transport: commandTransport,
          handler: receiver,
          clock,
          ...(commands.leaseDurationMs === undefined ? {} : { leaseDurationMs: commands.leaseDurationMs }),
          ...(commands.retryDelayMs === undefined ? {} : { retryDelayMs: commands.retryDelayMs }),
          ...(commands.limit === undefined ? {} : { limit: commands.limit }),
        }),
        ...(commands.idlePollIntervalMs === undefined ? {} : {
          idlePollIntervalMs: commands.idlePollIntervalMs,
        }),
        ...(commands.retryDelayMs === undefined ? {} : { retryDelayMs: commands.retryDelayMs }),
        ...(input.ports.wait === undefined ? {} : { wait: input.ports.wait }),
        ...(input.ports.nowMilliseconds === undefined ? {} : {
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
      throw new NodeRuntimeError("startup_failed", "원격 제어 시작 실패 뒤 저장소를 닫지 못했습니다.", {
        cause: new AggregateError([error, ...cleanupErrors]),
      });
    }
    if (error instanceof NodeRuntimeError) throw error;
    throw new NodeRuntimeError("startup_failed", "원격 제어 runtime을 열지 못했습니다.", {
      cause: error,
    });
  }
}
