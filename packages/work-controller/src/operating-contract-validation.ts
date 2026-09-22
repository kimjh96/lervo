import {
  operatingActionKinds,
  type OperatingActionPlanV1,
  type OperatingMandate,
  type WorkResponsibilityV1,
} from "@lervo/application-contract";

export const operatingHashPattern = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[a-z][a-z0-9_.:-]{0,127}$/u;
const AGENT = /^agt_[a-f0-9]{24}$/u;

export function operatingInteger(
  value: unknown,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

export function operatingTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function strings(
  value: unknown,
  check: (item: string) => boolean,
  maximum = 64,
  minimum = 0,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= minimum &&
    value.length <= maximum &&
    value.every((item) => typeof item === "string" && check(item)) &&
    new Set(value).size === value.length
  );
}

export function operatingPath(value: string): boolean {
  if (value === "*") return true;
  return (
    value.length > 0 &&
    value.length <= 1024 &&
    !/[\\\u0000-\u001f:*?[\]{}]/u.test(value) &&
    !value.startsWith("/") &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function object(value: unknown, fields: string[]): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field))
  );
}

const text = (value: string) =>
  value.trim().length > 0 && value.length <= 2048 && !value.includes("\0");

export function assertOperatingMandate(value: OperatingMandate): void {
  if (
    !object(value, [
      "schemaVersion",
      "mandateId",
      "version",
      "appointingAuthorityId",
      "ownerAgentId",
      "projectIds",
      "teamIds",
      "actionKinds",
      "roleIds",
      "capabilityCeiling",
      "pathRoots",
      "providers",
      "maximumWorkers",
      "maximumConcurrentAttempts",
      "maximumAttemptsPerAssignment",
      "maximumAttemptTokens",
      "maximumAggregateTokens",
      "maximumDeadlineMs",
      "issuedAt",
      "expiresAt",
      "revocationCoordinate",
      ...([2, 3].includes(value?.schemaVersion) ? ["executionAuthority"] : []),
      ...(value?.schemaVersion === 3 ? ["workScope"] : []),
      ...(value?.schemaVersion === 3 && Object.hasOwn(value, "successorAuthority")
        ? ["successorAuthority"]
        : []),
    ]) ||
    ![1, 2, 3].includes(value.schemaVersion) ||
    (value.schemaVersion !== 1 &&
      (!object(value.executionAuthority, ["schemaVersion", "mode", "hostIdentityHash"]) ||
        value.executionAuthority.schemaVersion !== 1 ||
        value.executionAuthority.mode !== "designated_host" ||
        !operatingHashPattern.test(value.executionAuthority.hostIdentityHash))) ||
    (value.schemaVersion === 3 &&
      (!object(value.workScope, [
        "schemaVersion",
        "workstreamId",
        "snapshotEventId",
        "snapshotEventHash",
        "excludedAssignments",
      ]) ||
        value.workScope.schemaVersion !== 1 ||
        !/^wks_[a-f0-9]{24}$/u.test(value.workScope.workstreamId) ||
        !/^evt_[a-f0-9]{32}$/u.test(value.workScope.snapshotEventId) ||
        !operatingHashPattern.test(value.workScope.snapshotEventHash) ||
        !Array.isArray(value.workScope.excludedAssignments) ||
        value.workScope.excludedAssignments.length > 256 ||
        value.workScope.excludedAssignments.some(
          (item) =>
            !object(item, ["assignmentId", "contentHash"]) ||
            !/^asn_[a-f0-9]{24}$/u.test(item.assignmentId) ||
            !operatingHashPattern.test(item.contentHash),
        ) ||
        new Set(value.workScope.excludedAssignments.map((item) => item.assignmentId)).size !==
          value.workScope.excludedAssignments.length ||
        (value.successorAuthority !== undefined &&
          (value.successorAuthority.schemaVersion === 1
            ? !object(value.successorAuthority, ["schemaVersion", "maximumSuccessors"]) ||
              !operatingInteger(value.successorAuthority.maximumSuccessors, 1, 1024)
            : value.successorAuthority.schemaVersion === 2
              ? !object(value.successorAuthority, [
                  "schemaVersion",
                  "maximumSuccessors",
                  "maximumAggregateTokens",
                ]) ||
                !operatingInteger(value.successorAuthority.maximumSuccessors, 1, 1024) ||
                !operatingInteger(
                  value.successorAuthority.maximumAggregateTokens,
                  value.maximumAttemptTokens,
                )
              : true)))) ||
    !ID.test(value.mandateId) ||
    !operatingInteger(value.version, 1) ||
    !ID.test(value.appointingAuthorityId) ||
    !AGENT.test(value.ownerAgentId) ||
    !strings(value.projectIds, (item) => /^prj_[a-f0-9]{16}$/u.test(item), 64, 1) ||
    !strings(value.teamIds, (item) => /^team_[A-Za-z0-9_-]{8,64}$/u.test(item), 64, 1) ||
    !strings(value.actionKinds, (item) => operatingActionKinds.includes(item as never), 11, 1) ||
    !strings(value.roleIds, (item) => ID.test(item), 64, 1) ||
    !strings(value.capabilityCeiling, (item) => ID.test(item)) ||
    !strings(value.pathRoots, operatingPath) ||
    !strings(value.providers, (item) => ID.test(item), 16, 1) ||
    !operatingInteger(value.maximumWorkers, 1, 256) ||
    !operatingInteger(value.maximumConcurrentAttempts, 1, 32) ||
    !operatingInteger(value.maximumAttemptsPerAssignment, 1, 4) ||
    !operatingInteger(value.maximumAttemptTokens, 1) ||
    !operatingInteger(value.maximumAggregateTokens, value.maximumAttemptTokens) ||
    !operatingInteger(value.maximumDeadlineMs, 1, 30 * 24 * 60 * 60 * 1000) ||
    !operatingTime(value.issuedAt) ||
    !operatingTime(value.expiresAt) ||
    Date.parse(value.expiresAt) <= Date.parse(value.issuedAt) ||
    !ID.test(value.revocationCoordinate)
  ) {
    throw new TypeError("The operating mandate contract is invalid.");
  }
}

export function assertOperatingActionPlan(value: OperatingActionPlanV1): void {
  if (
    !object(value, [
      "schemaVersion",
      "supervisionId",
      "projectId",
      "teamId",
      "workstreamId",
      "ownerAgentId",
      "mandateHash",
      "sourceRevisionDigest",
      "graphHash",
      "causationEventIds",
      "actionKind",
      "effectContract",
      "effectHash",
      "rationaleArtifactHash",
      "responsibilityArtifactHash",
      "roleId",
      "requiredCapabilities",
      "expectedPaths",
      "provider",
      "addedWorkers",
      "addedAssignments",
      "concurrentAttempts",
      "attemptNumber",
      "reservedTokens",
      "deadline",
    ]) ||
    value.schemaVersion !== 1 ||
    !ID.test(value.supervisionId) ||
    !/^prj_[a-f0-9]{16}$/u.test(value.projectId) ||
    !/^team_[A-Za-z0-9_-]{8,64}$/u.test(value.teamId) ||
    !/^wks_[a-f0-9]{24}$/u.test(value.workstreamId) ||
    !AGENT.test(value.ownerAgentId) ||
    ![
      value.mandateHash,
      value.sourceRevisionDigest,
      value.graphHash,
      value.effectHash,
      value.rationaleArtifactHash,
      value.responsibilityArtifactHash,
    ].every((item) => operatingHashPattern.test(item)) ||
    !strings(value.causationEventIds, (item) => /^evt_[a-f0-9]{32}$/u.test(item), 64, 1) ||
    !operatingActionKinds.includes(value.actionKind) ||
    !ID.test(value.effectContract) ||
    !ID.test(value.roleId) ||
    !strings(value.requiredCapabilities, (item) => ID.test(item)) ||
    !strings(value.expectedPaths, operatingPath) ||
    !ID.test(value.provider) ||
    !operatingInteger(value.addedWorkers, 0, 32) ||
    !operatingInteger(value.addedAssignments, 0, 32) ||
    !operatingInteger(value.concurrentAttempts, 0, 32) ||
    !operatingInteger(value.attemptNumber, 1, 4) ||
    !operatingInteger(value.reservedTokens, 1) ||
    !operatingTime(value.deadline)
  ) {
    throw new TypeError("The operating action plan contract is invalid.");
  }
}

export function assertWorkResponsibility(value: WorkResponsibilityV1): void {
  if (
    !object(value, [
      "schemaVersion",
      "assignmentId",
      "assignmentRevision",
      "executorAgentId",
      "reviewerAgentId",
      "roleId",
      "roleVersion",
      "roleContractHash",
      "taskPurpose",
      "deliverables",
      "acceptanceCriteria",
      "decisionLatitude",
      "expectedPaths",
      "requiredCapabilities",
      "verificationSuiteIds",
      "handoffRecipientIds",
      "startDeadline",
      "progressDeadline",
      "completionDeadline",
      "predecessorBindingHash",
    ]) ||
    value.schemaVersion !== 1 ||
    !/^asn_[a-f0-9]{24}$/u.test(value.assignmentId) ||
    !operatingInteger(value.assignmentRevision, 1) ||
    !AGENT.test(value.executorAgentId) ||
    !AGENT.test(value.reviewerAgentId) ||
    !ID.test(value.roleId) ||
    typeof value.roleVersion !== "string" ||
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u.test(
      value.roleVersion,
    ) ||
    value.roleVersion.length > 100 ||
    !operatingHashPattern.test(value.roleContractHash) ||
    typeof value.taskPurpose !== "string" ||
    !text(value.taskPurpose) ||
    !strings(value.deliverables, text, 32, 1) ||
    !strings(value.acceptanceCriteria, text, 32, 1) ||
    !strings(value.decisionLatitude, text, 32, 1) ||
    !strings(value.expectedPaths, operatingPath) ||
    !strings(value.requiredCapabilities, (item) => ID.test(item)) ||
    !strings(value.verificationSuiteIds, (item) => ID.test(item), 32, 1) ||
    !strings(value.handoffRecipientIds, (item) => AGENT.test(item), 32) ||
    ![value.startDeadline, value.progressDeadline, value.completionDeadline].every(operatingTime) ||
    Date.parse(value.startDeadline) > Date.parse(value.progressDeadline) ||
    Date.parse(value.progressDeadline) > Date.parse(value.completionDeadline) ||
    (value.predecessorBindingHash !== null &&
      !operatingHashPattern.test(value.predecessorBindingHash))
  ) {
    throw new TypeError("The work responsibility contract is invalid.");
  }
}
