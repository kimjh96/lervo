import { type SchemaName, validateSchema } from "@lervo/schemas";

export type ReportCompatibilityFailure =
  "invalid_semantics" | "invalid_structure" | "unsupported_version";

export function readVersionedReport<T>(input: {
  value: unknown;
  schemaName: SchemaName;
  schemaVersion: number;
  reportName: string;
  semantics: (report: T) => boolean;
  error: (failure: ReportCompatibilityFailure, message: string) => Error;
}): T {
  const version = schemaVersionOf(input.value);
  if (typeof version === "number" && Number.isInteger(version) && version !== input.schemaVersion) {
    throw input.error(
      "unsupported_version",
      `Unsupported ${input.reportName} schemaVersion: ${String(version)}`,
    );
  }
  if (!validateSchema(input.schemaName, input.value).valid) {
    throw input.error(
      "invalid_structure",
      `The required structure of ${input.reportName} v${input.schemaVersion} is invalid.`,
    );
  }
  const report = input.value as T;
  if (!input.semantics(report)) {
    throw input.error(
      "invalid_semantics",
      `The required semantics of ${input.reportName} v${input.schemaVersion} are inconsistent.`,
    );
  }
  return report;
}

function schemaVersionOf(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return (value as { schemaVersion?: unknown }).schemaVersion;
}
