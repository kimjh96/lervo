import { parse } from "yaml";

const HASH = /^sha256:[a-f0-9]{64}$/u;

/** Read only the source binding of a reviewed document normalization record. */
export function documentNormalizationRecordSource(
  content: string,
): { sourcePath: string; sourceContentHash: string } | null {
  let record: unknown;
  try {
    record = parse(content);
  } catch {
    return null;
  }
  const value = record as { sourcePath?: unknown; sourceContentHash?: unknown } | null;
  if (
    value === null ||
    typeof value !== "object" ||
    typeof value.sourcePath !== "string" ||
    typeof value.sourceContentHash !== "string" ||
    !HASH.test(value.sourceContentHash)
  )
    return null;
  return { sourcePath: value.sourcePath, sourceContentHash: value.sourceContentHash };
}
