import type { WorkResponsibilityV1 } from "@lervo/application-contract";
import type { NativeOwnerPlanInput } from "./supervision-native-plans.js";

/** Parses the model's bounded staffing requirement; no assignment or lease is created here. */
/** Floor for one responsibility's completion window, unless the mandate deadline is shorter. */
export const MINIMUM_COMPLETION_WINDOW_MS = 600_000;

export function nativeTaskRequirement(
  input: NativeOwnerPlanInput,
  details: Record<string, unknown>,
) {
  const { facts, base } = input;
  const keys = [
    "roleId",
    "taskPurpose",
    "deliverables",
    "acceptanceCriteria",
    "decisionLatitude",
    "expectedPaths",
    "requiredCapabilities",
    "verificationSuiteIds",
    "completionSeconds",
  ];
  const textList = (value: unknown): value is string[] =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 32 &&
    value.every(
      (item) => typeof item === "string" && item.trim().length > 0 && item.length <= 2048,
    );
  if (
    Object.keys(details).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(details, key)) ||
    typeof details.roleId !== "string" ||
    typeof details.taskPurpose !== "string" ||
    details.taskPurpose.trim().length === 0 ||
    details.taskPurpose.length > 4096 ||
    !keys.slice(2, -1).every((key) => textList(details[key])) ||
    !Number.isSafeInteger(details.completionSeconds) ||
    Number(details.completionSeconds) < 30 ||
    Number(details.completionSeconds) * 1000 > facts.mandate.maximumDeadlineMs
  )
    throw new Error("Owner allocation details do not define a bounded complete responsibility.");
  const role = facts.roles.find(
    (item) => item.roleId === details.roleId && facts.mandate.roleIds.includes(item.roleId),
  );
  if (role === undefined)
    throw new Error("The owner allocation role is outside its installed mandate.");
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
    taskPurpose: details.taskPurpose,
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
  return { task, role };
}
