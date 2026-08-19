import type {
  AdapterCapabilityMatrix,
  AdapterNormalizedEvent,
  AdapterSession,
  AdapterStartRequest,
  AdapterStopRequest,
  AdapterStopResult,
  AdapterTurn,
} from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";

import {
  ManagedProviderRunError,
  type ManagedProviderRunInput,
  type ManagedProviderRunOptions,
} from "./provider-run-types.js";

export function assertAdapterMessage(value: unknown, label: string): void {
  if (!validateSchema("adapter", value).valid) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      `${label}이 adapter 계약을 통과하지 못했습니다.`,
    );
  }
}

function expectedWritingPolicyId(input: ManagedProviderRunInput): string | null {
  const presentation = input.context.role.outputContract.presentation;
  return presentation.audience === "machine" ? null : presentation.writingPolicyId;
}

export function validateManagedProviderRunInput(
  input: ManagedProviderRunInput,
  options: Pick<ManagedProviderRunOptions, "coordinates" | "projectVerifier">,
): void {
  const skillIds = input.resolvedSkills.map((skill) => skill.skillId);
  const roleSkillIds = [...input.context.role.defaultSkills].sort();
  const resolvedSkillIds = [...skillIds].sort();
  if (
    input.instructions.length === 0 ||
    input.risk.length === 0 ||
    input.targetTurnId.length === 0 ||
    input.context.role.roleId !== options.coordinates.roleId ||
    input.context.expectedPaths.length === 0 ||
    new Set(skillIds).size !== skillIds.length ||
    roleSkillIds.length !== resolvedSkillIds.length ||
    roleSkillIds.some((skillId, index) => skillId !== resolvedSkillIds[index]) ||
    input.resolvedSkills.some((skill) =>
      !/^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/.test(skill.skillId) ||
      !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(skill.version) ||
      !/^sha256:[a-f0-9]{64}$/.test(skill.contentHash)
    )
  ) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "Managed run 요청의 task, 파일 쓰기 정책 또는 예상 경로가 유효하지 않습니다.",
    );
  }
  const writeDecision = input.context.role.capabilities["filesystem.write"];
  if (
    (writeDecision !== "require_approval" && input.approvalAuthorization !== undefined) ||
    (input.approvalAuthorization !== undefined &&
      !validateSchema("managedRunApprovalAuthorization", input.approvalAuthorization).valid)
  ) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "파일 쓰기 정책과 signed approval authorization 입력이 일치하지 않습니다.",
    );
  }
  if (input.verificationSuites !== undefined) {
    const suiteIds = input.verificationSuites.map((suite) => suite.suiteId);
    const roleSuiteIds = [...input.context.role.verification.suiteIds].sort();
    const requestedSuiteIds = [...suiteIds].sort();
    if (
      options.projectVerifier === undefined ||
      input.verificationSuites.length === 0 ||
      input.verificationSuites.length > 16 ||
      new Set(suiteIds).size !== suiteIds.length ||
      input.verificationSuites.some((suite) => !validateSchema("verificationSuite", suite).valid) ||
      roleSuiteIds.length !== requestedSuiteIds.length ||
      roleSuiteIds.some((suiteId, index) => suiteId !== requestedSuiteIds[index])
    ) {
      throw new ManagedProviderRunError(
        "contract_validation_failed",
        "Role과 project verification suite 입력이 다르거나 실행 port가 없습니다.",
      );
    }
  }
  const writingPolicyId = expectedWritingPolicyId(input);
  if (
    writingPolicyId !== input.writingPolicy?.writingPolicyId &&
    !(writingPolicyId === null && input.writingPolicy === null)
  ) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "Role의 writing policy와 managed run 입력이 다릅니다.",
    );
  }
}

export async function verifyManagedProviderRunApproval(input: {
  run: ManagedProviderRunInput;
  options: ManagedProviderRunOptions;
  evaluatedAt: string;
}): Promise<void> {
  if (input.run.context.role.capabilities["filesystem.write"] !== "require_approval") {
    return;
  }
  const authorization = input.run.approvalAuthorization;
  const verifier = input.options.approvalVerifier;
  if (authorization === undefined || verifier === undefined) {
    throw new ManagedProviderRunError(
      "approval_required",
      "Managed write 실행에 signed approval authorization이 필요합니다.",
    );
  }
  let result;
  try {
    result = await verifier.verify({
      authorization,
      ...input.options.coordinates,
      provider: input.options.adapter.descriptor.provider,
      risk: input.run.risk,
      requestDigest: input.run.requestDigest,
      verificationSuiteIds: [...input.run.context.role.verification.suiteIds],
      expectedPaths: [...input.run.context.expectedPaths],
      requestedPath: null,
      evaluatedAt: input.evaluatedAt,
    });
  } catch (error) {
    throw new ManagedProviderRunError(
      "approval_required",
      "Managed write approval 원본을 검증하지 못했습니다.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
  if (!result.approved) {
    throw new ManagedProviderRunError(
      "approval_required",
      `Managed write approval이 현재 실행에 유효하지 않습니다: ${result.reasonCode}`,
    );
  }
  if (
    result.policySnapshotId !== authorization.policySnapshotId ||
    !authorization.approvalIds.includes(result.approvalId)
  ) {
    throw new ManagedProviderRunError(
      "approval_required",
      "Approval verifier 결과가 전달된 authorization 좌표와 다릅니다.",
    );
  }
}

export function createAdapterStartRequest(input: {
  run: ManagedProviderRunInput;
  options: ManagedProviderRunOptions;
  requestedAt: string;
}): AdapterStartRequest {
  const request: AdapterStartRequest = {
    kind: "start_request",
    schemaVersion: 1,
    adapterId: input.options.adapter.descriptor.adapterId,
    projectId: input.options.coordinates.projectId,
    runId: input.options.coordinates.runId,
    sessionId: input.options.coordinates.sessionId,
    roleId: input.options.coordinates.roleId,
    writingPolicyId: expectedWritingPolicyId(input.run),
    requestDigest: input.run.requestDigest,
    executionMode:
      input.run.context.role.capabilities["filesystem.write"] !== "deny"
        ? "managed_write"
        : "read_only",
    requestedAt: input.requestedAt,
  };
  assertAdapterMessage(request, "Adapter start request");
  return request;
}

export function assertManagedSession(input: {
  request: AdapterStartRequest;
  session: AdapterSession;
  provider: string;
  descriptorCapabilities: AdapterCapabilityMatrix;
}): void {
  assertAdapterMessage(input.session, "Adapter session");
  if (
    input.session.adapterId !== input.request.adapterId ||
    input.session.projectId !== input.request.projectId ||
    input.session.runId !== input.request.runId ||
    input.session.sessionId !== input.request.sessionId ||
    input.session.roleId !== input.request.roleId ||
    input.session.writingPolicyId !== input.request.writingPolicyId ||
    input.session.executionMode !== input.request.executionMode ||
    (input.session.executionMode === "read_only" &&
      input.session.effectiveCapabilities.fileChanges === "supported") ||
    (input.session.executionMode === "managed_write" &&
      input.session.effectiveCapabilities.fileChanges !== "supported") ||
    Object.entries(input.session.effectiveCapabilities).some(
      ([capability, support]) =>
        support === "supported" &&
        input.descriptorCapabilities[capability as keyof AdapterCapabilityMatrix] !== "supported",
    ) ||
    input.session.provider !== input.provider
  ) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "Adapter session이 managed run 좌표 또는 실행 모드와 다릅니다.",
    );
  }
}

export function assertTerminalTurn(
  turn: AdapterTurn,
  event: AdapterNormalizedEvent,
): void {
  if (
    (event.type !== "provider.turn.completed" && event.type !== "provider.turn.failed") ||
    event.payload.providerTurnId !== turn.providerTurnId
  ) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "Provider terminal signal이 현재 managed turn과 다릅니다.",
    );
  }
}

export function assertManagedTurn(input: {
  request: import("@lervo/schemas").AdapterTurnRequest;
  session: AdapterSession;
  turn: AdapterTurn;
}): void {
  assertAdapterMessage(input.turn, "Adapter turn");
  if (
    input.turn.adapterId !== input.session.adapterId ||
    input.turn.projectId !== input.session.projectId ||
    input.turn.runId !== input.session.runId ||
    input.turn.sessionId !== input.session.sessionId ||
    input.turn.providerSessionId !== input.session.providerSessionId ||
    input.turn.targetTurnId !== input.request.targetTurnId
  ) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "Adapter turn이 managed session 또는 target turn 좌표와 다릅니다.",
    );
  }
}

export function assertManagedStopResult(input: {
  request: AdapterStopRequest;
  result: AdapterStopResult;
}): void {
  assertAdapterMessage(input.result, "Adapter stop result");
  if (
    input.result.adapterId !== input.request.adapterId ||
    input.result.projectId !== input.request.projectId ||
    input.result.runId !== input.request.runId ||
    input.result.sessionId !== input.request.sessionId ||
    input.result.providerSessionId !== input.request.providerSessionId ||
    input.result.status !== input.request.reason
  ) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "Adapter stop result가 managed session 좌표와 다릅니다.",
    );
  }
}
