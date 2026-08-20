import { searchSourceKinds, SearchError, type SearchSourceReference } from "./types.js";

export const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
export const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

export function safeRepositoryPath(path: string): boolean {
  return path.length > 0 && path.length <= 500 && !path.startsWith("/") &&
    !/^[A-Za-z]:/.test(path) && !path.includes("\\") && !path.endsWith("/") &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

export function assertSourceReference(source: SearchSourceReference): void {
  if (!searchSourceKinds.includes(source.kind) || !SOURCE_ID_PATTERN.test(source.sourceId) ||
    !SHA256_PATTERN.test(source.contentHash) ||
    (source.path !== undefined && !safeRepositoryPath(source.path))) {
    throw new SearchError("corpus_invalid", "검색 source 좌표가 유효하지 않습니다.");
  }
}

export function assertText(value: unknown, maximum: number, code: "corpus_invalid" | "invalid_query"): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || CONTROL_PATTERN.test(value)) {
    throw new SearchError(code, "검색 문자열이 허용 범위를 벗어났습니다.");
  }
  return value;
}

export function assertTimestamp(
  value: string,
  code: "invalid_assessment" | "invalid_attempt" | "invalid_evaluation_case" |
    "invalid_evaluation_result" | "invalid_evaluation_run",
): void {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new SearchError(code, "검색 관측 시각이 canonical ISO 형식이 아닙니다.");
  }
}
