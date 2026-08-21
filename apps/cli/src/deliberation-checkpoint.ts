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

const maximumCheckpointBytes = 1024 * 1024;
const deliberationIdPattern = /^dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;

export interface ApprovedDeliberationCheckpoint {
  schemaVersion: 1;
  deliberationId: string;
  policyHash: string;
  request: Omit<InlineManagedDeliberationRequest, "repositoryRoot"> |
    Omit<StoredManagedDeliberationRequest, "repositoryRoot">;
  runtimeCoordinates: DeliberationRuntimeCoordinates;
  runtime: DeliberationRuntimeSnapshot;
  workspace: DeliberationWorkspaceSnapshot;
  latestClaimArtifactId: string;
  approvedReviewArtifactIds: string[];
  currentClaim: { claimId: string; claimDigest: string };
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
      "재개할 숙의 ID가 유효하지 않습니다.",
    );
  }
  return resolve(stateRoot, "deliberations", deliberationId, "checkpoints", "approved.json");
}

function validCheckpointRequest(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  if (typeof request.topic !== "string" || request.topic.trim().length === 0 ||
    request.topic.length > 20_000) return false;
  if (typeof request.policyId === "string") {
    return request.proposerProvider === undefined && request.reviewerProvider === undefined &&
      request.verificationSuiteIds === undefined;
  }
  const suites = request.verificationSuiteIds;
  return (request.proposerProvider === "codex" || request.proposerProvider === "claude") &&
    (request.reviewerProvider === "codex" || request.reviewerProvider === "claude") &&
    request.proposerProvider !== request.reviewerProvider && Array.isArray(suites) &&
    suites.length > 0 && suites.length <= 16 && new Set(suites).size === suites.length &&
    suites.every((suite) => typeof suite === "string");
}

function validateCheckpoint(value: unknown, deliberationId: string): ApprovedDeliberationCheckpoint {
  const checkpoint = value as Partial<ApprovedDeliberationCheckpoint> | null;
  if (
    checkpoint === null || typeof checkpoint !== "object" ||
    checkpoint.schemaVersion !== 1 || checkpoint.deliberationId !== deliberationId ||
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
    typeof checkpoint.createdAt !== "string" ||
    !validCheckpointRequest(checkpoint.request)
  ) {
    throw new DeliberationCheckpointError(
      "deliberation_checkpoint_invalid",
      "숙의 재개 checkpoint 형식이 유효하지 않습니다.",
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
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStats = await lstat(directory);
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    throw new DeliberationCheckpointError(
      "deliberation_checkpoint_invalid",
      "숙의 checkpoint 디렉터리가 안전하지 않습니다.",
    );
  }
  const bytes = `${JSON.stringify(input.checkpoint, null, 2)}\n`;
  if (Buffer.byteLength(bytes) > maximumCheckpointBytes) {
    throw new DeliberationCheckpointError(
      "deliberation_checkpoint_invalid",
      "숙의 재개 checkpoint가 크기 제한을 넘었습니다.",
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
        "숙의 승인 checkpoint를 덮어쓸 수 없습니다.",
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
        "숙의 재개 checkpoint가 안전한 일반 파일이 아니거나 너무 큽니다.",
      );
    }
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (
      before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
    ) throw new Error("checkpoint changed");
    return validateCheckpoint(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      input.deliberationId,
    );
  } catch (error) {
    if (error instanceof DeliberationCheckpointError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new DeliberationCheckpointError(
        "deliberation_checkpoint_not_found",
        "재개 가능한 승인 checkpoint를 찾지 못했습니다.",
      );
    }
    throw new DeliberationCheckpointError(
      "deliberation_checkpoint_invalid",
      "숙의 재개 checkpoint를 안전하게 읽지 못했습니다.",
      { cause: error },
    );
  } finally {
    await handle?.close();
  }
}
