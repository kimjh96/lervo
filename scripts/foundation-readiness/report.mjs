import { createHash } from "node:crypto";

const hashPattern = /^sha256:[a-f0-9]{64}$/u;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function reportId(value) {
  return `fready_${createHash("sha256").update(canonical(value)).digest("hex").slice(0, 24)}`;
}

function validObservation(value, checkIds, repositoryRevision) {
  return (
    value !== null &&
    typeof value === "object" &&
    Number.isInteger(value.sequence) &&
    typeof value.observedAt === "string" &&
    value.repositoryRevision === repositoryRevision &&
    value.status === "passed" &&
    Array.isArray(value.checks) &&
    value.checks.length === checkIds.length &&
    value.checks.every(
      (check, index) =>
        check?.checkId === checkIds[index] &&
        check.status === "passed" &&
        typeof check.durationMs === "number" &&
        check.durationMs >= 0 &&
        hashPattern.test(check.outputHash),
    )
  );
}

export function createFoundationReadinessReport(input) {
  const body = {
    schemaVersion: 1,
    reportVersion: "foundation-readiness-v1",
    repositoryRevision: input.repositoryRevision,
    releaseBaseRevision: input.releaseBaseRevision,
    environment: input.environment,
    constituentReports: input.constituentReports,
    suiteBindings: input.suiteBindings,
    checkIds: input.checkIds,
    unsupportedStates: input.unsupportedStates,
    observations: input.observations,
    allPassed: true,
  };
  return verifyFoundationReadinessReport({ ...body, reportId: reportId(body) });
}

export function verifyFoundationReadinessReport(value) {
  if (value === null || typeof value !== "object") throw new TypeError("Invalid readiness report.");
  const body = { ...value };
  delete body.reportId;
  const valid =
    value.schemaVersion === 1 &&
    value.reportVersion === "foundation-readiness-v1" &&
    hashPattern.test(value.repositoryRevision) &&
    typeof value.releaseBaseRevision === "string" &&
    value.environment?.nodeVersion?.startsWith("v") &&
    typeof value.environment?.operatingSystem === "string" &&
    typeof value.environment?.architecture === "string" &&
    Array.isArray(value.constituentReports) &&
    value.constituentReports.length === 2 &&
    value.constituentReports.every(
      (report) => typeof report?.reportId === "string" && hashPattern.test(report.contentHash),
    ) &&
    Array.isArray(value.suiteBindings) &&
    value.suiteBindings.length > 0 &&
    value.suiteBindings.every(
      (binding) => typeof binding?.path === "string" && hashPattern.test(binding.contentHash),
    ) &&
    Array.isArray(value.checkIds) &&
    value.checkIds.length > 0 &&
    new Set(value.checkIds).size === value.checkIds.length &&
    value.checkIds.every((checkId) => typeof checkId === "string") &&
    Array.isArray(value.unsupportedStates) &&
    value.unsupportedStates.every((state) => typeof state === "string") &&
    Array.isArray(value.observations) &&
    value.observations.length === 3 &&
    value.observations.every((item) =>
      validObservation(item, value.checkIds, value.repositoryRevision),
    ) &&
    value.observations.every((item, index) => item.sequence === index + 1) &&
    value.allPassed === true &&
    value.reportId === reportId(body);
  if (!valid) throw new TypeError("Foundation readiness report does not satisfy v1.");
  return value;
}
