import { isAbsolute } from "node:path";
import type {
  AdapterCapabilityActivationReceipt,
  AdapterCapabilityActivationRequest,
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
      `${label} does not satisfy the adapter contract.`,
    );
  }
}

export function assertCapabilityActivationReceipts(input: {
  requests: readonly AdapterCapabilityActivationRequest[];
  receipts: readonly AdapterCapabilityActivationReceipt[];
  session: AdapterSession;
}): void {
  const expected = new Map(input.requests.map((request) => [request.capabilityId, request]));
  const receivedIds = new Set<string>();
  if (input.receipts.length !== input.requests.length) {
    throw new ManagedProviderRunError(
      "capability_activation_failed",
      "The provider did not confirm every requested capability activation.",
    );
  }
  for (const receipt of input.receipts) {
    assertAdapterMessage(receipt, "Capability activation receipt");
    const request = expected.get(receipt.capabilityId);
    if (
      request === undefined ||
      receivedIds.has(receipt.capabilityId) ||
      receipt.adapterId !== input.session.adapterId ||
      receipt.projectId !== input.session.projectId ||
      receipt.runId !== input.session.runId ||
      receipt.sessionId !== input.session.sessionId ||
      receipt.providerSessionId !== input.session.providerSessionId ||
      receipt.capabilityKind !== request.capabilityKind ||
      receipt.version !== request.version ||
      receipt.contentHash !== request.contentHash ||
      (request.capabilityKind === "mcp_server" && receipt.evidence !== "mcp_connected") ||
      (request.capabilityKind === "provider_plugin" && receipt.evidence !== "plugin_loaded")
    ) {
      throw new ManagedProviderRunError(
        "capability_activation_failed",
        "A provider capability activation receipt differs from its exact request or session binding.",
      );
    }
    receivedIds.add(receipt.capabilityId);
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
  if (
    (input.resultFormat !== undefined && !["markdown", "json"].includes(input.resultFormat)) ||
    (input.resultFormat === "json" &&
      input.context.role.outputContract.presentation.audience !== "machine")
  )
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "The result format is invalid.",
    );
  const skillIds = input.resolvedSkills.map((skill) => skill.skillId);
  const capabilityActivations = input.capabilityActivations ?? [];
  const roleSkillIds = [...input.context.role.defaultSkills].sort();
  const resolvedSkillIds = [...skillIds].sort();
  const writeDecision = input.context.role.capabilities["filesystem.write"];
  const expectedPathCount = input.context.expectedPaths.length;
  if (
    (input.executionMode !== undefined && input.executionMode !== "read_only") ||
    (input.executionMode === "read_only" &&
      (expectedPathCount !== 0 || input.approvalAuthorization !== undefined)) ||
    input.instructions.length === 0 ||
    input.risk.length === 0 ||
    input.targetTurnId.length === 0 ||
    input.context.role.roleId !== options.coordinates.roleId ||
    (input.contextRepositoryRoot !== undefined &&
      (typeof input.contextRepositoryRoot !== "string" ||
        !isAbsolute(input.contextRepositoryRoot) ||
        input.contextRepositoryRoot.includes("\0"))) ||
    (input.executionMode !== "read_only" &&
      writeDecision !== "deny" &&
      input.context.expectedPaths.length === 0) ||
    expectedPathCount > 16 ||
    new Set(input.context.expectedPaths).size !== expectedPathCount ||
    (expectedPathCount > 1 && input.createTargetTurnId === undefined) ||
    new Set(skillIds).size !== skillIds.length ||
    roleSkillIds.length !== resolvedSkillIds.length ||
    roleSkillIds.some((skillId, index) => skillId !== resolvedSkillIds[index]) ||
    input.resolvedSkills.some(
      (skill) =>
        !/^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/.test(skill.skillId) ||
        !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
          skill.version,
        ) ||
        !/^sha256:[a-f0-9]{64}$/.test(skill.contentHash),
    ) ||
    capabilityActivations.length > 128 ||
    new Set(capabilityActivations.map((item) => item.capabilityId)).size !==
      capabilityActivations.length ||
    capabilityActivations.some(
      (item) => !validateSchema("adapterCapabilityActivationRequest", item).valid,
    )
  ) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "The managed run request task, file-write policy, or expected paths are invalid.",
    );
  }
  if (
    (writeDecision !== "require_approval" && input.approvalAuthorization !== undefined) ||
    (input.approvalAuthorization !== undefined &&
      !validateSchema("managedRunApprovalAuthorization", input.approvalAuthorization).valid)
  ) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "The file-write policy and signed approval authorization input do not agree.",
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
        "The role and project verification suite inputs differ, or an execution port is missing.",
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
      "The role writing policy differs from the managed run input.",
    );
  }
}

export async function verifyManagedProviderRunApproval(input: {
  run: ManagedProviderRunInput;
  options: ManagedProviderRunOptions;
  evaluatedAt: string;
}): Promise<void> {
  if (
    input.run.executionMode === "read_only" ||
    input.run.context.role.capabilities["filesystem.write"] !== "require_approval"
  ) {
    return;
  }
  const authorization = input.run.approvalAuthorization;
  const verifier = input.options.approvalVerifier;
  if (authorization === undefined || verifier === undefined) {
    throw new ManagedProviderRunError(
      "approval_required",
      "Managed write execution requires signed approval authorization.",
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
      "Could not validate the managed write approval source.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
  if (!result.approved) {
    throw new ManagedProviderRunError(
      "approval_required",
      `The managed write approval is not valid for the current run: ${result.reasonCode}`,
    );
  }
  if (
    result.policySnapshotId !== authorization.policySnapshotId ||
    !authorization.approvalIds.includes(result.approvalId)
  ) {
    throw new ManagedProviderRunError(
      "approval_required",
      "The approval verifier result differs from the supplied authorization coordinates.",
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
      input.run.executionMode !== "read_only" &&
      input.run.context.role.capabilities["filesystem.write"] !== "deny"
        ? "managed_write"
        : "read_only",
    requestedAt: input.requestedAt,
    capabilityActivations: [...structuredClone(input.run.capabilityActivations ?? [])],
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
      "The adapter session differs from the managed run coordinates or execution mode.",
    );
  }
}

export function assertTerminalTurn(turn: AdapterTurn, event: AdapterNormalizedEvent): void {
  if (
    (event.type !== "provider.turn.completed" && event.type !== "provider.turn.failed") ||
    event.payload.providerTurnId !== turn.providerTurnId
  ) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "The provider terminal signal differs from the current managed turn.",
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
      "The adapter turn differs from the managed session or target turn coordinates.",
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
      "The adapter stop result differs from the managed session coordinates.",
    );
  }
}
