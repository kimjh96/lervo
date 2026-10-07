import type { NodeRuntimeHealthSnapshot } from "@lervo/node-runtime";
import type { RegisterNodeFleetInstanceResult } from "@lervo/repository-registry";

import { CommandFailure } from "./command-error-output.js";
import type { NodeConfiguredExecutablesReport } from "./node-config-executable-status.js";
import type {
  NodeReadinessBaseline,
  NodeReadinessBlocker,
  NodeReadinessCarriedCondition,
} from "./node-fleet-readiness-policy.js";

/** Why readiness was not proved: the last observation's blockers and process coordinates. */
export interface NodeFleetReadinessFailure {
  baseline: NodeReadinessBaseline["status"];
  blockers: NodeReadinessBlocker[];
  lastStatus: NodeRuntimeHealthSnapshot["status"] | null;
  lastProcessId: number | null;
  observations: number;
}

/**
 * Bounded, secret-free failure details. `failedCode` names the failure that started recovery, and
 * `recovery` reports whether the prior service state was restored after that failure.
 */
export type NodeFleetApplyFailureDetails = {
  readiness?: NodeFleetReadinessFailure;
  failedCode?: string;
  recovery?: "restored" | "failed";
  recoveryFailureCode?: string;
};

export class NodeFleetApplyError extends CommandFailure {
  declare readonly details: NodeFleetApplyFailureDetails;

  constructor(
    code: string,
    message: string,
    options?: ErrorOptions & { details?: NodeFleetApplyFailureDetails },
  ) {
    super(code, message, options?.details ?? {});
    this.name = "NodeFleetApplyError";
    if (options !== undefined && "cause" in options) this.cause = options.cause;
  }
}

export function failNodeFleetApply(
  code: string,
  message: string,
  cause?: unknown,
  details?: NodeFleetApplyFailureDetails,
): never {
  throw new NodeFleetApplyError(code, message, {
    ...(cause === undefined ? {} : { cause }),
    ...(details === undefined ? {} : { details }),
  });
}

function failureCode(error: unknown): string {
  return error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "node_fleet_apply_failed";
}

/**
 * Compensates a failed operation without losing why it failed. A failed compensation becomes
 * `node_fleet_recovery_failed` that still names the original failure code, its message, and its
 * readiness blockers; a successful one marks the original failure as `restored`.
 */
export async function recoverNodeFleetFailure(
  failure: unknown,
  compensate: () => Promise<void>,
  operation: string,
): Promise<void> {
  const original = failure instanceof NodeFleetApplyError ? failure : null;
  if (original?.details.recovery !== undefined) return;
  try {
    await compensate();
  } catch (recoveryError) {
    failNodeFleetApply(
      "node_fleet_recovery_failed",
      `${operation} failed (${failureCode(failure)}${
        original === null ? "" : `: ${original.message}`
      }) and the prior service state could not be restored (${failureCode(recoveryError)}).`,
      recoveryError,
      {
        ...original?.details,
        failedCode: failureCode(failure),
        recovery: "failed",
        recoveryFailureCode: failureCode(recoveryError),
      },
    );
  }
  if (original !== null) original.details.recovery = "restored";
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
    workspaceCoordination: "ready" | "disabled" | `unavailable:${string}`;
    remoteControl: "ready" | "disabled" | `unavailable:${string}`;
    conversation: string;
    supervision: string;
    /** Whether a predecessor snapshot was available to carry unchanged conditions from. */
    baseline: NodeReadinessBaseline["status"];
    /** Pre-existing non-delivery conditions the replacement kept unchanged; never hidden. */
    carriedConditions: NodeReadinessCarriedCondition[];
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
      conversation: string;
      supervision: string;
      updatedAt: string | null;
    };
    recoveryAction: "none" | "reapply_exact_plan" | "inspect_runtime_failure" | "wait_for_runtime";
    /** ADR-0487: configured executables a restart would need, observed now. */
    configuredExecutables: NodeConfiguredExecutablesReport;
  }>;
}
