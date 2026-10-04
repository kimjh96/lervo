import { readOwnerOnlyText } from "@lervo/runtime-security";

import type { RepositoryReplicaConflictPolicy } from "./repository-replica-merge.js";

export interface RepositoryReplicaCoordinatorConfig {
  schemaVersion: 1;
  stateFile: string;
  pollIntervalMs: number;
  maximumConcurrency?: number;
  peerWatch?: boolean;
  peer: {
    executable: string;
    arguments: string[];
    destination: string;
    remoteNodeExecutable: string;
    remoteRuntimeExecutable: string;
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

const CONFLICT_POLICIES = ["hold", "prefer_local", "prefer_peer"];

export async function readRepositoryReplicaCoordinatorConfig(
  path: string,
): Promise<RepositoryReplicaCoordinatorConfig> {
  const value = JSON.parse(
    await readOwnerOnlyText(path, 1024 * 1024),
  ) as RepositoryReplicaCoordinatorConfig;
  if (
    value.schemaVersion !== 1 ||
    typeof value.stateFile !== "string" ||
    !Number.isSafeInteger(value.pollIntervalMs) ||
    value.pollIntervalMs < 1_000 ||
    value.pollIntervalMs > 60_000 ||
    (value.maximumConcurrency !== undefined &&
      (!Number.isSafeInteger(value.maximumConcurrency) ||
        value.maximumConcurrency < 1 ||
        value.maximumConcurrency > 4)) ||
    (value.peerWatch !== undefined && typeof value.peerWatch !== "boolean") ||
    typeof value.peer !== "object" ||
    value.peer === null ||
    typeof value.peer.executable !== "string" ||
    !Array.isArray(value.peer.arguments) ||
    value.peer.arguments.some((item) => typeof item !== "string") ||
    typeof value.peer.destination !== "string" ||
    typeof value.peer.remoteNodeExecutable !== "string" ||
    typeof value.peer.remoteRuntimeExecutable !== "string" ||
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
