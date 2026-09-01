import type { NodeRuntimeHealthSnapshot } from "@lervo/node-runtime";
import type { RegisterNodeFleetInstanceResult } from "@lervo/repository-registry";

export class NodeFleetApplyError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NodeFleetApplyError";
    this.code = code;
  }
}

export function failNodeFleetApply(code: string, message: string, cause?: unknown): never {
  throw new NodeFleetApplyError(code, message, cause === undefined ? undefined : { cause });
}

export interface NodeFleetServiceResult {
  change: "installed" | "activated" | "upgraded" | "rolled_back" | "unchanged" | "removed";
  managerAvailable: boolean;
  installed: boolean;
  active: boolean;
  enabled: boolean | null;
  serviceIdentity: string;
}

export interface NodeFleetApplyPorts {
  executablePath?: string;
  serviceOptions?: {
    platform?: NodeJS.Platform;
    homeDirectory?: string;
    uid?: number;
    runCommand?: (command: string, args: string[]) => Promise<{ exitCode: number | null }>;
    wait?: (durationMs: number) => Promise<void>;
  };
  wait?: (durationMs: number) => Promise<void>;
  readHealth?: (path: string) => Promise<NodeRuntimeHealthSnapshot>;
}

export interface NodeFleetApplyReceipt {
  schemaVersion: 1;
  operation: "repository_node_onboarding";
  planId: string;
  service: NodeFleetServiceResult;
  readiness: {
    status: "ready" | "offline_ready";
    observations: 3;
    processId: number;
    startedAt: string;
    sync: "ready" | "unavailable:hub_unavailable";
    workstreamReplication: "ready" | "unavailable:hub_unavailable";
    workspaceCoordination: "ready" | "disabled" | "unavailable:hub_unavailable";
    remoteControl: "ready" | "disabled" | "unavailable:hub_unavailable";
  };
  registry: RegisterNodeFleetInstanceResult;
}

export interface NodeFleetStatusReport {
  schemaVersion: 1;
  status: "ready" | "degraded";
  instances: Array<{
    projectId: string;
    serviceInstanceId: string;
    repositoryRoot: string;
    destinationId: string;
    runtimeVersion: string;
    service: {
      managerAvailable: boolean;
      installed: boolean;
      active: boolean;
      enabled: boolean | null;
    };
    runtime: {
      status: "ready" | "starting" | "degraded" | "stopping" | "unavailable" | "stale";
      sync: string;
      workstreamReplication: string;
      workspaceCoordination: string;
      remoteControl: string;
      updatedAt: string | null;
    };
    recoveryAction: "none" | "reapply_exact_plan" | "inspect_runtime_failure" | "wait_for_runtime";
  }>;
}
