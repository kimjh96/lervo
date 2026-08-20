import { type SchemaName, validateSchema } from "@lervo/schemas";

export type ReportCompatibilityFailure =
  | "invalid_semantics"
  | "invalid_structure"
  | "unsupported_version";

export function readVersionedReport<T>(input: {
  value: unknown;
  schemaName: SchemaName;
  schemaVersion: number;
  reportName: string;
  semantics: (report: T) => boolean;
  error: (failure: ReportCompatibilityFailure, message: string) => Error;
}): T {
  const version = schemaVersionOf(input.value);
  if (
    typeof version === "number" &&
    Number.isInteger(version) &&
    version !== input.schemaVersion
  ) {
    throw input.error(
      "unsupported_version",
      `지원하지 않는 ${input.reportName} schemaVersion입니다: ${String(version)}`,
    );
  }
  if (!validateSchema(input.schemaName, input.value).valid) {
    throw input.error(
      "invalid_structure",
      `${input.reportName} v${input.schemaVersion}의 필수 구조가 올바르지 않습니다.`,
    );
  }
  const report = input.value as T;
  if (!input.semantics(report)) {
    throw input.error(
      "invalid_semantics",
      `${input.reportName} v${input.schemaVersion}의 필수 의미가 서로 일치하지 않습니다.`,
    );
  }
  return report;
}

function schemaVersionOf(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return (value as { schemaVersion?: unknown }).schemaVersion;
}
