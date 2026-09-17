import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type {
  DeliberationRuntimeCoordinates,
  DeliberationRuntimeSnapshot,
} from "@lervo/deliberation-runtime";

import type { DeliberationWorkspaceSnapshot } from "./deliberation-workspace.js";
import type {
  InlineManagedDeliberationRequest,
  StoredManagedDeliberationRequest,
} from "./managed-deliberation.js";
import type { ManagedDeliberationBudgetUsage } from "./managed-deliberation-budget.js";

const maximumCheckpointBytes = 1024 * 1024;
const deliberationIdPattern = /^dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;

export interface ApprovedDeliberationCheckpoint {
  schemaVersion: 1;
  deliberationId: string;
  policyHash: string;
  request:
    | Omit<InlineManagedDeliberationRequest, "repositoryRoot">
    | Omit<StoredManagedDeliberationRequest, "repositoryRoot">;
  runtimeCoordinates: DeliberationRuntimeCoordinates;
  runtime: DeliberationRuntimeSnapshot;
  workspace: DeliberationWorkspaceSnapshot;
  latestClaimArtifactId: string;
  approvedReviewArtifactIds: string[];
  currentClaim: { claimId: string; claimDigest: string };
  budgetUsage?: ManagedDeliberationBudgetUsage;
  createdAt: string;
}

export class DeliberationCheckpointError extends Error {
  constructor(
    readonly code:
      | "deliberation_checkpoint_exists"
      | "deliberation_checkpoint_invalid"
      | "deliberation_checkpoint_not_found",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DeliberationCheckpointError";
  }
}

function checkpointPath(stateRoot: string, deliberationId: string): string {
  if (!deliberationIdPattern.test(deliberationId)) {
    throw new DeliberationCheckpointError(
      "deliberation_checkpoint_invalid",
      "The deliberation ID to resume is invalid.",
    );
  }
  return resolve(stateRoot, "deliberations", deliberationId, "checkpoints", "approved.json");
}

function validCheckpointRequest(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  if (
    typeof request.topic !== "string" ||
    request.topic.trim().length === 0 ||
    request.topic.length > 20_000 ||
    (request.executionMaximumElapsedMs !== undefined &&
      (!Number.isSafeInteger(request.executionMaximumElapsedMs) ||
        Number(request.executionMaximumElapsedMs) < 1_000 ||
        Number(request.executionMaximumElapsedMs) > 3_600_000))
  )
    return false;
  if (typeof request.policyId === "string") {
    return (
      request.proposerProvider === undefined &&
      request.reviewerProvider === undefined &&
      request.verificationSuiteIds === undefined
    );
  }
  const suites = request.verificationSuiteIds;
  return (
    (request.proposerProvider === "codex" || request.proposerProvider === "claude") &&
    (request.reviewerProvider === "codex" || request.reviewerProvider === "claude") &&
    request.proposerProvider !== request.reviewerProvider &&
    Array.isArray(suites) &&
    suites.length > 0 &&
    suites.length <= 16 &&
    new Set(suites).size === suites.length &&
    suites.every((suite) => typeof suite === "string")
  );
}

function validateCheckpoint(
  value: unknown,
  deliberationId: string,
): ApprovedDeliberationCheckpoint {
  const checkpoint = value as Partial<ApprovedDeliberationCheckpoint> | null;
  if (
    checkpoint === null ||
    typeof checkpoint !== "object" ||
    checkpoint.schemaVersion !== 1 ||
    checkpoint.deliberationId !== deliberationId ||
    typeof checkpoint.policyHash !== "string" ||
    checkpoint.runtime?.deliberationId !== deliberationId ||
    checkpoint.runtime.policyHash !== checkpoint.policyHash ||
    checkpoint.runtime.schemaVersion !== 1 ||
    !Array.isArray(checkpoint.runtime.artifacts) ||
    !Array.isArray(checkpoint.runtime.verificationEvidence) ||
    !Array.isArray(checkpoint.runtime.providerSessionRoles) ||
    !Array.isArray(checkpoint.runtime.recordedEvents) ||
    !Array.isArray(checkpoint.runtime.publications) ||
    !Array.isArray(checkpoint.runtime.handoffs) ||
    checkpoint.workspace?.schemaVersion !== 1 ||
    !Array.isArray(checkpoint.workspace.participantRoleIds) ||
    checkpoint.workspace.generatedDocuments === null ||
    typeof checkpoint.workspace.generatedDocuments !== "object" ||
    !Array.isArray(checkpoint.workspace.contexts) ||
    checkpoint.runtimeCoordinates?.projectId === undefined ||
    typeof checkpoint.runtimeCoordinates.runId !== "string" ||
    typeof checkpoint.runtimeCoordinates.sessionId !== "string" ||
    typeof checkpoint.latestClaimArtifactId !== "string" ||
    !Array.isArray(checkpoint.approvedReviewArtifactIds) ||
    checkpoint.approvedReviewArtifactIds.length === 0 ||
    !checkpoint.approvedReviewArtifactIds.every((id) => typeof id === "string") ||
    typeof checkpoint.currentClaim?.claimId !== "string" ||
    typeof checkpoint.currentClaim.claimDigest !== "string" ||
    (checkpoint.budgetUsage !== undefined &&
      (!Number.isSafeInteger(checkpoint.budgetUsage.providerCalls) ||
        checkpoint.budgetUsage.providerCalls < 0 ||
        !Number.isSafeInteger(checkpoint.budgetUsage.observedTokens) ||
        checkpoint.budgetUsage.observedTokens < 0 ||
        typeof checkpoint.budgetUsage.startedAt !== "string" ||
        !Number.isFinite(Date.parse(checkpoint.budgetUsage.startedAt)))) ||
    typeof checkpoint.createdAt !== "string" ||
    !validCheckpointRequest(checkpoint.request)
  ) {
    throw new DeliberationCheckpointError(
      "deliberation_checkpoint_invalid",
      "The deliberation resume checkpoint has an invalid shape.",
    );
  }
  return structuredClone(checkpoint as ApprovedDeliberationCheckpoint);
}

export async function writeApprovedDeliberationCheckpoint(input: {
  stateRoot: string;
  checkpoint: ApprovedDeliberationCheckpoint;
}): Promise<void> {
  const path = checkpointPath(input.stateRoot, input.checkpoint.deliberationId);
  validateCheckpoint(input.checkpoint, input.checkpoint.deliberationId);
  const directory = dirname(path);
  const deliberationRoot = await lstat(dirname(directory));
  if (!deliberationRoot.isDirectory() || deliberationRoot.isSymbolicLink()) {
    throw new DeliberationCheckpointError(
      "deliberation_checkpoint_invalid",
      "The deliberation run directory is unsafe.",
    );
  }
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const directoryStats = await lstat(directory);
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    throw new DeliberationCheckpointError(
      "deliberation_checkpoint_invalid",
      "The deliberation checkpoint directory is unsafe.",
    );
  }
  const bytes = `${JSON.stringify(input.checkpoint, null, 2)}\n`;
  if (Buffer.byteLength(bytes) > maximumCheckpointBytes) {
    throw new DeliberationCheckpointError(
      "deliberation_checkpoint_invalid",
      "The deliberation resume checkpoint exceeds the size limit.",
    );
  }
  let handle;
  try {
    handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new DeliberationCheckpointError(
        "deliberation_checkpoint_exists",
        "An approved deliberation checkpoint cannot be overwritten.",
      );
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function readApprovedDeliberationCheckpoint(input: {
  stateRoot: string;
  deliberationId: string;
}): Promise<ApprovedDeliberationCheckpoint> {
  const path = checkpointPath(input.stateRoot, input.deliberationId);
  let handle;
  try {
    const before = await lstat(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.size > maximumCheckpointBytes) {
      throw new DeliberationCheckpointError(
        "deliberation_checkpoint_invalid",
        "The deliberation resume checkpoint is not a safe regular file or is too large.",
      );
    }
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    )
      throw new Error("checkpoint changed");
    return validateCheckpoint(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      input.deliberationId,
    );
  } catch (error) {
    if (error instanceof DeliberationCheckpointError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new DeliberationCheckpointError(
        "deliberation_checkpoint_not_found",
        "No resumable approved checkpoint was found.",
      );
    }
    throw new DeliberationCheckpointError(
      "deliberation_checkpoint_invalid",
      "The deliberation resume checkpoint could not be read safely.",
      { cause: error },
    );
  } finally {
    await handle?.close();
  }
}
