const FAILURE_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const PROJECT_ID_PATTERN = /^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const DESTINATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;

const baseKeys = [
  "processId",
  "remoteControl",
  "schemaVersion",
  "startedAt",
  "status",
  "sync",
  "updatedAt",
];
const currentRequiredKeys = ["workstreamReplication", "workspaceCoordination"];
const currentOptionalKeys = [
  "conversation",
  "eventReader",
  "eventReaderIdentity",
  "presenceToken",
  "supervision",
];
/** ADR-0611: the process presence token a Node records once its socket listens. */
const PRESENCE_TOKEN_PATTERN = /^[a-z0-9-]{1,160}$/u;

function exactKeys(value, expected) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
  );
}

function component(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (value.status === "pending" || value.status === "ready" || value.status === "disabled") {
    return exactKeys(value, ["status"]);
  }
  return (
    value.status === "unavailable" &&
    typeof value.failureCode === "string" &&
    FAILURE_CODE_PATTERN.test(value.failureCode) &&
    exactKeys(value, ["failureCode", "status"])
  );
}

function supervisionComponent(value) {
  if (component(value)) return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (value.status === "dormant") {
    return value.reasonCode === "workstream_inactive" && exactKeys(value, ["reasonCode", "status"]);
  }
  if (value.status === "attention") {
    const budget = value.resourceBudget;
    return (
      value.reasonCode === "goal_budget_insufficient" &&
      exactKeys(value, ["reasonCode", "resourceBudget", "status"]) &&
      exactKeys(budget, [
        "limitTokens",
        "observedTokens",
        "remainingTokens",
        "requestedTokens",
        "reservedTokens",
        "schemaVersion",
        "scope",
      ]) &&
      budget.schemaVersion === 1 &&
      budget.scope === "goal" &&
      [
        budget.limitTokens,
        budget.observedTokens,
        budget.remainingTokens,
        budget.requestedTokens,
        budget.reservedTokens,
      ].every((item) => Number.isSafeInteger(item) && item >= 0) &&
      budget.remainingTokens ===
        Math.max(0, budget.limitTokens - budget.observedTokens - budget.reservedTokens)
    );
  }
  return (
    value.status === "unavailable" &&
    typeof value.failureCode === "string" &&
    FAILURE_CODE_PATTERN.test(value.failureCode) &&
    (value.reasonCodes === undefined ||
      (Array.isArray(value.reasonCodes) &&
        value.reasonCodes.length <= 16 &&
        value.reasonCodes.every(
          (code) => typeof code === "string" && FAILURE_CODE_PATTERN.test(code),
        ))) &&
    exactKeys(
      value,
      value.reasonCodes === undefined
        ? ["failureCode", "status"]
        : ["failureCode", "reasonCodes", "status"],
    )
  );
}

function eventReader(value) {
  if (!exactKeys(value, ["capability", "readableEventSchemaVersions", "schemaVersion"])) {
    return false;
  }
  const versions = value.readableEventSchemaVersions;
  return (
    value.schemaVersion === 1 &&
    value.capability === "event_reader" &&
    Array.isArray(versions) &&
    versions.length >= 1 &&
    versions.length <= 16 &&
    versions.every(
      (version, index) =>
        Number.isInteger(version) &&
        version >= 1 &&
        version <= 255 &&
        (index === 0 || versions[index - 1] < version),
    )
  );
}

function eventReaderIdentity(value) {
  return (
    exactKeys(value, ["destinationId", "projectId", "repositoryIdentityHash"]) &&
    typeof value.projectId === "string" &&
    PROJECT_ID_PATTERN.test(value.projectId) &&
    typeof value.repositoryIdentityHash === "string" &&
    HASH_PATTERN.test(value.repositoryIdentityHash) &&
    typeof value.destinationId === "string" &&
    DESTINATION_ID_PATTERN.test(value.destinationId)
  );
}

function currentSnapshotKeys(value) {
  const keys = Object.keys(value);
  const required = [...baseKeys, ...currentRequiredKeys];
  if (required.some((key) => !keys.includes(key))) return false;
  const allowed = new Set([...required, ...currentOptionalKeys]);
  return keys.every((key) => allowed.has(key));
}

function componentReady(value) {
  return value.status === "ready" || value.status === "disabled";
}

function readyComponentsAgree(value, current) {
  if (value.status !== "ready") return true;
  if (value.sync.status !== "ready" || !componentReady(value.remoteControl)) return false;
  return (
    !current ||
    (value.workstreamReplication.status === "ready" &&
      componentReady(value.workspaceCoordination) &&
      (value.conversation === undefined || componentReady(value.conversation)) &&
      (value.supervision === undefined ||
        ["ready", "disabled", "dormant", "attention"].includes(value.supervision.status)))
  );
}

export function validNodeRuntimeHealthSnapshot(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const current = currentSnapshotKeys(value);
  if (!current && !exactKeys(value, baseKeys)) return false;
  return (
    value.schemaVersion === 1 &&
    ["starting", "ready", "degraded", "stopping"].includes(value.status) &&
    Number.isSafeInteger(value.processId) &&
    value.processId >= 1 &&
    Number.isFinite(Date.parse(value.startedAt)) &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    Date.parse(value.updatedAt) >= Date.parse(value.startedAt) &&
    component(value.sync) &&
    component(value.remoteControl) &&
    (!current ||
      (component(value.workstreamReplication) &&
        component(value.workspaceCoordination) &&
        (value.conversation === undefined || component(value.conversation)) &&
        (value.supervision === undefined || supervisionComponent(value.supervision)) &&
        (value.eventReader === undefined || eventReader(value.eventReader)) &&
        (value.eventReaderIdentity === undefined ||
          eventReaderIdentity(value.eventReaderIdentity)) &&
        (value.presenceToken === undefined ||
          (typeof value.presenceToken === "string" &&
            PRESENCE_TOKEN_PATTERN.test(value.presenceToken))))) &&
    readyComponentsAgree(value, current)
  );
}
