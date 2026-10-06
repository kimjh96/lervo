import { isAbsolute, join } from "node:path";

import { readOwnerOnlyText } from "@lervo/runtime-security";

import type { RepositoryReplicaConflictPolicy } from "./repository-replica-merge.js";

/**
 * ADR-0483: the per-host pointer `lervo upgrade` keeps at the activated Node runtime. A peer
 * configured with `remoteRuntimesDirectory` always runs `<directory>/current/node-runtime.js`.
 */
export const NODE_RUNTIME_CURRENT_POINTER = "current";
export const NODE_RUNTIME_PAYLOAD = "node-runtime.js";

export interface RepositoryReplicaCoordinatorConfig {
  schemaVersion: 1;
  stateFile: string;
  pollIntervalMs: number;
  /** Ceiling the idle recovery sweep backs off to while every replica stays current. */
  idleRecoveryCeilingMs?: number;
  maximumConcurrency?: number;
  peerWatch?: boolean;
  peer: {
    executable: string;
    arguments: string[];
    destination: string;
    remoteNodeExecutable: string;
    /** The peer's Node runtimes directory; the coordinator follows its `current` pointer. */
    remoteRuntimesDirectory?: string;
    /** An explicit runtime payload; an override that `capture-version` still validates. */
    remoteRuntimeExecutable?: string;
    remoteCommandPrefix?: string[];
    commandTimeoutMs?: number;
  };
  repositories: Array<{
    replicaId: string;
    localRoot: string;
    peerRoot: string;
    conflictPolicy?: RepositoryReplicaConflictPolicy;
  }>;
}

export const DEFAULT_IDLE_RECOVERY_CEILING_MS = 600_000;
const CONFLICT_POLICIES = ["hold", "prefer_local", "prefer_peer"];
const TOP_LEVEL_KEYS = [
  "schemaVersion",
  "stateFile",
  "pollIntervalMs",
  "idleRecoveryCeilingMs",
  "maximumConcurrency",
  "peerWatch",
  "peer",
  "repositories",
];
const PEER_KEYS = [
  "executable",
  "arguments",
  "destination",
  "remoteNodeExecutable",
  "remoteRuntimesDirectory",
  "remoteRuntimeExecutable",
  "remoteCommandPrefix",
  "commandTimeoutMs",
];
const REPOSITORY_KEYS = ["replicaId", "localRoot", "peerRoot", "conflictPolicy"];

/** A misspelled or misplaced key would otherwise be ignored silently, as one was on 2026-10-06. */
function onlyKnownKeys(value: unknown, keys: readonly string[]): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

const absolute = (value: unknown) =>
  typeof value === "string" && isAbsolute(value) && !/[\0\r\n]/u.test(value);

/** The remote command's runtime payload: the explicit override, else the peer's pointer. */
export function remoteRuntimePayload(peer: RepositoryReplicaCoordinatorConfig["peer"]): string {
  return (
    peer.remoteRuntimeExecutable ??
    join(peer.remoteRuntimesDirectory!, NODE_RUNTIME_CURRENT_POINTER, NODE_RUNTIME_PAYLOAD)
  );
}

export async function readRepositoryReplicaCoordinatorConfig(
  path: string,
): Promise<RepositoryReplicaCoordinatorConfig> {
  const value = JSON.parse(
    await readOwnerOnlyText(path, 1024 * 1024),
  ) as RepositoryReplicaCoordinatorConfig;
  if (
    !onlyKnownKeys(value, TOP_LEVEL_KEYS) ||
    value.schemaVersion !== 1 ||
    typeof value.stateFile !== "string" ||
    !Number.isSafeInteger(value.pollIntervalMs) ||
    value.pollIntervalMs < 1_000 ||
    value.pollIntervalMs > 60_000 ||
    (value.idleRecoveryCeilingMs !== undefined &&
      (!Number.isSafeInteger(value.idleRecoveryCeilingMs) ||
        value.idleRecoveryCeilingMs < 30_000 ||
        value.idleRecoveryCeilingMs > 3_600_000)) ||
    (value.maximumConcurrency !== undefined &&
      (!Number.isSafeInteger(value.maximumConcurrency) ||
        value.maximumConcurrency < 1 ||
        value.maximumConcurrency > 4)) ||
    (value.peerWatch !== undefined && typeof value.peerWatch !== "boolean") ||
    !onlyKnownKeys(value.peer, PEER_KEYS) ||
    typeof value.peer.executable !== "string" ||
    !Array.isArray(value.peer.arguments) ||
    value.peer.arguments.some((item) => typeof item !== "string") ||
    typeof value.peer.destination !== "string" ||
    typeof value.peer.remoteNodeExecutable !== "string" ||
    (value.peer.remoteRuntimesDirectory === undefined) ===
      (value.peer.remoteRuntimeExecutable === undefined) ||
    (value.peer.remoteRuntimesDirectory !== undefined &&
      !absolute(value.peer.remoteRuntimesDirectory)) ||
    (value.peer.remoteRuntimeExecutable !== undefined &&
      typeof value.peer.remoteRuntimeExecutable !== "string") ||
    (value.peer.commandTimeoutMs !== undefined &&
      (!Number.isSafeInteger(value.peer.commandTimeoutMs) ||
        value.peer.commandTimeoutMs < 1_000 ||
        value.peer.commandTimeoutMs > 300_000)) ||
    (value.peer.remoteCommandPrefix !== undefined &&
      (!Array.isArray(value.peer.remoteCommandPrefix) ||
        value.peer.remoteCommandPrefix.some((item) => typeof item !== "string"))) ||
    !Array.isArray(value.repositories) ||
    value.repositories.length < 1 ||
    value.repositories.length > 64 ||
    value.repositories.some(
      (item) =>
        !onlyKnownKeys(item, REPOSITORY_KEYS) ||
        typeof item.replicaId !== "string" ||
        typeof item.localRoot !== "string" ||
        typeof item.peerRoot !== "string" ||
        (item.conflictPolicy !== undefined && !CONFLICT_POLICIES.includes(item.conflictPolicy)),
    )
  ) {
    throw new Error("The repository replica coordinator configuration is invalid.");
  }
  return value;
}
