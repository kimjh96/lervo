import type { DocumentStalenessRepositorySnapshot } from "./document-staleness-types.js";
import { DocumentStalenessError } from "./document-staleness-types.js";
import { normalizeScanPath } from "./filesystem.js";

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const MAXIMUM_SNAPSHOT_FILES = 20_000;

export function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

export function invalidStalenessRequest(message: string, options?: ErrorOptions): never {
  throw new DocumentStalenessError("invalid_staleness_request", message, options);
}

export function isContentHash(value: string): boolean {
  return SHA256.test(value);
}

export function normalizeStalenessTimestamp(
  value: string,
  label: string,
): { value: string; milliseconds: number } {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (match === null) {
    invalidStalenessRequest(`${label} must be a date-time with an explicit timezone.`);
  }
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    offsetHourText,
    offsetMinuteText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    (offsetHourText !== undefined && Number(offsetHourText) > 23) ||
    (offsetMinuteText !== undefined && Number(offsetMinuteText) > 59)
  ) {
    invalidStalenessRequest(`${label} has an invalid date or time range.`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    invalidStalenessRequest(`${label} cannot be parsed as a valid time.`);
  }
  return { value: new Date(milliseconds).toISOString(), milliseconds };
}

export function validateStalenessSnapshot(
  snapshot: DocumentStalenessRepositorySnapshot,
  label: string,
): void {
  if (snapshot.revision.length < 1 || snapshot.revision.length > 200) {
    invalidStalenessRequest(`${label} revision does not satisfy the contract.`);
  }
  const entries = Object.entries(snapshot.files);
  if (entries.length > MAXIMUM_SNAPSHOT_FILES) {
    invalidStalenessRequest(`${label} exceeds the file count limit.`);
  }
  const normalizedPaths = new Set<string>();
  for (const [path, contentHash] of entries) {
    let normalized: string;
    try {
      normalized = normalizeScanPath(path);
    } catch (error) {
      invalidStalenessRequest(`${label} contains an unsafe path.`, { cause: error });
    }
    if (normalized === "." || normalized.endsWith("/") || normalizedPaths.has(normalized)) {
      invalidStalenessRequest(`${label} contains a non-file path or duplicate path.`);
    }
    if (!isContentHash(contentHash)) {
      invalidStalenessRequest(`${label} contains an invalid content hash.`);
    }
    normalizedPaths.add(normalized);
  }
}

export function snapshotsHaveSameFiles(
  left: DocumentStalenessRepositorySnapshot,
  right: DocumentStalenessRepositorySnapshot,
): boolean {
  const leftPaths = Object.keys(left.files).sort(compareText);
  const rightPaths = Object.keys(right.files).sort(compareText);
  return (
    leftPaths.length === rightPaths.length &&
    leftPaths.every(
      (path, index) => path === rightPaths[index] && left.files[path] === right.files[path],
    )
  );
}
