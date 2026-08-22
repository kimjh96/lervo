import { lstat } from "node:fs/promises";

import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { loadProjectManifest, resolveProjectPaths } from "@lervo/project";
import { readOwnerOnlyText, RuntimeSecurityError } from "@lervo/runtime-security";
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
import { NodeRuntimeError } from "./errors.js";
import {
  createNodeRuntimeDeployment,
  type NodeRuntimeDeployment,
} from "./lifecycle.js";
import {
  openNodeRemoteControlRuntime,
  type NodeRemoteCommandPorts,
  type NodeRemoteControlRuntime,
} from "./control-runtime.js";

const MAX_BEARER_TOKEN_FILE_BYTES = 4_098;

export interface NodeRuntimeOpenPorts {
  createTransport?: (options: SyncHttpTransportOptions) => AuthenticatedHubTransport;
  wait?: OutboundSyncPollingWaitPort;
  nowMilliseconds?: () => number;
  onCycle?: (result: SyncCycleResult) => void | Promise<void>;
  remoteCommands?: NodeRemoteCommandPorts;
}

function normalizedToken(value: string): string {
  const token = value.endsWith("\r\n") ? value.slice(0, -2) :
    value.endsWith("\n") ? value.slice(0, -1) : value;
  if (
    token.length < 32 || token.length > 4_096 ||
    !/^[\x21-\x7e]+$/.test(token)
  ) throw new NodeRuntimeError("invalid_config", "Hub bearer token 파일이 유효하지 않습니다.");
  return token;
}

async function assertRepositoryRoot(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("unsafe root");
  } catch (error) {
    throw new NodeRuntimeError(
      "project_invalid",
      "Node runtime 저장소 root는 초기화된 실제 디렉터리여야 합니다.",
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
  try {
    const validated = parseNodeRuntimeConfig(config, process.cwd());
    await assertRepositoryRoot(validated.repositoryRoot);
    const paths = resolveProjectPaths(validated.repositoryRoot);
    const manifest = await loadProjectManifest(validated.repositoryRoot);
    if (!manifest.dataPolicy.hubSyncEnabled) {
      throw new NodeRuntimeError(
        "project_invalid",
        "Project data policy에서 Hub sync가 활성화되지 않았습니다.",
      );
    }
    let tokenText: string;
    try {
      tokenText = await readOwnerOnlyText(validated.hub.bearerTokenFile, MAX_BEARER_TOKEN_FILE_BYTES);
    } catch (error) {
      const code = error instanceof RuntimeSecurityError && error.code === "invalid_text"
        ? "invalid_config"
        : "unsafe_runtime_file";
      throw new NodeRuntimeError(code, "Hub bearer token 파일을 안전하게 읽지 못했습니다.", {
        cause: error,
      });
    }
    const bearerToken = normalizedToken(tokenText);
    store = await SQLiteEventStore.open({ path: paths.eventDatabase, projectId: manifest.projectId });
    const target = {
      projectId: manifest.projectId,
      projectIdentityHash: calculateProjectIdentityHash(manifest),
    };
    if ((validated.remoteCommands === undefined) !== (ports.remoteCommands === undefined)) {
      throw new NodeRuntimeError(
        "invalid_config",
        "원격 제어 구성과 실행기·로컬 정책 port는 함께 제공해야 합니다.",
      );
    }
    if (validated.remoteCommands !== undefined && ports.remoteCommands !== undefined) {
      remoteControl = await openNodeRemoteControlRuntime({
        config: validated,
        token: bearerToken,
        target,
        stateDirectory: paths.state,
        ports: ports.remoteCommands,
      });
    }
    const transportOptions: SyncHttpTransportOptions = {
      baseUrl: validated.hub.baseUrl,
      bearerToken,
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
    };
    const transport = (ports.createTransport ?? ((options) =>
      new AuthenticatedHubHttpTransport(options)))(transportOptions);
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
    return createNodeRuntimeDeployment(store, (signal) => runOutboundSyncLoop({
      worker,
      signal,
      ...(validated.sync.idlePollIntervalMs === undefined ? {} : {
        idlePollIntervalMs: validated.sync.idlePollIntervalMs,
      }),
      ...(ports.wait === undefined ? {} : { wait: ports.wait }),
      ...(ports.nowMilliseconds === undefined ? {} : { nowMilliseconds: ports.nowMilliseconds }),
      ...(ports.onCycle === undefined ? {} : { onCycle: ports.onCycle }),
    }), remoteControl ?? null);
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
      throw new NodeRuntimeError("startup_failed", "Node runtime 시작 실패 뒤 저장소를 닫지 못했습니다.", {
        cause: new AggregateError([error, ...cleanupErrors]),
      });
    }
    if (error instanceof NodeRuntimeError) throw error;
    throw new NodeRuntimeError("startup_failed", "Node runtime 구성을 열지 못했습니다.", {
      cause: error,
    });
  }
}
