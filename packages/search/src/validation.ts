import {
  searchSourceKinds,
  SearchError,
  type SearchErrorCode,
  type SearchSourceReference,
} from "./types.js";

export const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
export const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

export function safeRepositoryPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 500 &&
    !path.startsWith("/") &&
    !/^[A-Za-z]:/.test(path) &&
    !path.includes("\\") &&
    !path.endsWith("/") &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

export function assertSourceReference(source: SearchSourceReference): void {
  if (
    !searchSourceKinds.includes(source.kind) ||
    !SOURCE_ID_PATTERN.test(source.sourceId) ||
    !SHA256_PATTERN.test(source.contentHash) ||
    (source.path !== undefined && !safeRepositoryPath(source.path))
  ) {
    throw new SearchError("corpus_invalid", "The search source coordinates are invalid.");
  }
}

export function assertText(
  value: unknown,
  maximum: number,
  code: "corpus_invalid" | "invalid_query",
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    CONTROL_PATTERN.test(value)
  ) {
    throw new SearchError(code, "The search string is outside the allowed bounds.");
  }
  return value;
}

export function assertTimestamp(value: string, code: SearchErrorCode): void {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new SearchError(code, "The search observation timestamp is not in canonical ISO format.");
  }
}
