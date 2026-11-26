import type { WorkResponsibilityV1 } from "@lervo/application-contract";
import { assertWorkResponsibility, operatingPath } from "@lervo/work-controller";
import type { NativeOwnerPlanInput } from "./supervision-native-plans.js";

/** Exact allocation detail keys; feedback names only these so no model text is echoed. */
export const NATIVE_TASK_DETAIL_KEYS = [
  "roleId",
  "taskPurpose",
  "deliverables",
  "acceptanceCriteria",
  "decisionLatitude",
  "expectedPaths",
  "requiredCapabilities",
  "verificationSuiteIds",
  "completionSeconds",
] as const;

export class InvalidNativeOwnerProposalError extends Error {
  constructor(
    readonly reasonCode: "invalid_expected_path" | "invalid_task_contract",
    readonly invalidFields: readonly string[] = [],
    options?: ErrorOptions,
  ) {
    super(`The owner proposal has ${reasonCode}.`, options);
    this.name = "InvalidNativeOwnerProposalError";
  }
}

/** Floor for one responsibility's completion window, unless the mandate deadline is shorter. */
export const MINIMUM_COMPLETION_WINDOW_MS = 600_000;

export function nativeTaskRequirement(
  input: NativeOwnerPlanInput,
  details: Record<string, unknown>,
) {
  const { facts, base } = input;
  const keys: readonly string[] = NATIVE_TASK_DETAIL_KEYS;
  const textList = (value: unknown): value is string[] =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 32 &&
    value.every(
      (item) => typeof item === "string" && item.trim().length > 0 && item.length <= 2048,
    );
  const invalidFields = keys.filter((key) =>
    key === "roleId"
      ? typeof details.roleId !== "string"
      : key === "taskPurpose"
        ? typeof details.taskPurpose !== "string" ||
          details.taskPurpose.trim().length === 0 ||
          // The work responsibility contract bounds every text field at 2,048 characters.
          details.taskPurpose.length > 2048
        : key === "completionSeconds"
          ? !Number.isSafeInteger(details.completionSeconds) ||
            Number(details.completionSeconds) < 30 ||
            Number(details.completionSeconds) * 1000 > facts.mandate.maximumDeadlineMs
          : !textList(details[key]),
  );
  if (Object.keys(details).some((key) => !keys.includes(key)))
    invalidFields.push("unexpected_field");
  if (invalidFields.length > 0)
    throw new InvalidNativeOwnerProposalError("invalid_task_contract", invalidFields);
  if (!(details.expectedPaths as string[]).every(operatingPath))
    throw new InvalidNativeOwnerProposalError("invalid_expected_path", ["expectedPaths"]);
  if (
    (details.requiredCapabilities as string[]).some(
      (capability) =>
        !["filesystem.read", "filesystem.write", "shell.execute"].includes(capability),
    )
  )
    throw new InvalidNativeOwnerProposalError("invalid_task_contract", ["requiredCapabilities"]);
  const role = facts.roles.find(
    (item) => item.roleId === details.roleId && facts.mandate.roleIds.includes(item.roleId),
  );
  if (role === undefined)
    throw new InvalidNativeOwnerProposalError("invalid_task_contract", ["roleId"]);
  const now = Date.parse(input.now());
  // A worker turn needs a full bounded lease plus admission latency; the owner cannot go below it.
  const duration = Math.max(
    Number(details.completionSeconds) * 1000,
    Math.min(MINIMUM_COMPLETION_WINDOW_MS, facts.mandate.maximumDeadlineMs),
  );
  const task: WorkResponsibilityV1 = {
    schemaVersion: 1,
    assignmentId: `asn_${"0".repeat(24)}`,
    assignmentRevision: 2,
    executorAgentId: base.ownerAgentId,
    reviewerAgentId: base.ownerAgentId,
    roleId: role.roleId,
    roleVersion: role.version,
    roleContractHash: role.contractHash,
    taskPurpose: details.taskPurpose as string,
    deliverables: details.deliverables as string[],
    acceptanceCriteria: details.acceptanceCriteria as string[],
    decisionLatitude: details.decisionLatitude as string[],
    expectedPaths: details.expectedPaths as string[],
    requiredCapabilities: details.requiredCapabilities as string[],
    verificationSuiteIds: details.verificationSuiteIds as string[],
    handoffRecipientIds: [base.ownerAgentId],
    predecessorBindingHash: null,
    startDeadline: new Date(now + Math.min(300_000, Math.floor(duration / 3))).toISOString(),
    progressDeadline: new Date(
      now + Math.min(600_000, Math.floor((duration * 2) / 3)),
    ).toISOString(),
    completionDeadline: new Date(now + duration).toISOString(),
  };
  try {
    assertWorkResponsibility(task);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new InvalidNativeOwnerProposalError("invalid_task_contract", [], { cause: error });
  }
  return { task, role };
}
