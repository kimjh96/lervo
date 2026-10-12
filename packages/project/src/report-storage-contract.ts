import { canonicalJson } from "@lervo/event-contract";
import { contentHash } from "./filesystem.js";

export class ReportStorageError extends Error {
  constructor(
    readonly code:
      "report_storage_invalid" | "report_storage_stale" | "report_storage_recovery_required",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ReportStorageError";
  }
}

export interface ReportStorageReader {
  readerId: string;
  peerIdentityHash: string | null;
  artifactHash: string;
  readableStorageFormats: readonly [3, 4];
}
export interface ReportStorageEvidence {
  schemaVersion: 1;
  projectId: string;
  observedAt: string;
  writerCoordinateHash: string;
  readers: readonly ReportStorageReader[];
  rollback: { artifactHash: string; readableStorageFormats: readonly [3, 4] };
}
export interface ReportStorageCoordinate {
  schemaVersion: 1;
  format: "sqlite_v1";
  activationId: string;
  evidence: ReportStorageEvidence;
}

function invalid(): never {
  throw new ReportStorageError("report_storage_invalid", "Report storage evidence is invalid.");
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const source = value as Record<string, unknown>;
  if (Object.keys(source).length !== keys.length || keys.some((key) => !Object.hasOwn(source, key)))
    invalid();
  return source;
}
function hash(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}
function formats(value: unknown): boolean {
  return Array.isArray(value) && value.length === 2 && value[0] === 3 && value[1] === 4;
}

export function readReportStorageEvidence(value: unknown): ReportStorageEvidence {
  const source = object(value, [
    "schemaVersion",
    "projectId",
    "observedAt",
    "writerCoordinateHash",
    "readers",
    "rollback",
  ]);
  if (
    source.schemaVersion !== 1 ||
    typeof source.projectId !== "string" ||
    !/^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(source.projectId) ||
    typeof source.observedAt !== "string" ||
    !Number.isFinite(Date.parse(source.observedAt)) ||
    new Date(source.observedAt).toISOString() !== source.observedAt ||
    !hash(source.writerCoordinateHash) ||
    !Array.isArray(source.readers) ||
    source.readers.length < 1 ||
    source.readers.length > 64
  )
    invalid();
  let previous = "";
  for (const value of source.readers) {
    const reader = object(value, [
      "readerId",
      "peerIdentityHash",
      "artifactHash",
      "readableStorageFormats",
    ]);
    if (
      typeof reader.readerId !== "string" ||
      !/^[A-Za-z0-9_.:-]{1,128}$/u.test(reader.readerId) ||
      reader.readerId <= previous ||
      (reader.peerIdentityHash !== null && !hash(reader.peerIdentityHash)) ||
      !hash(reader.artifactHash) ||
      !formats(reader.readableStorageFormats)
    )
      invalid();
    previous = reader.readerId;
  }
  const rollback = object(source.rollback, ["artifactHash", "readableStorageFormats"]);
  if (!hash(rollback.artifactHash) || !formats(rollback.readableStorageFormats)) invalid();
  return structuredClone(source) as unknown as ReportStorageEvidence;
}

export function createReportStorageCoordinate(value: unknown): ReportStorageCoordinate {
  const evidence = readReportStorageEvidence(value);
  return {
    schemaVersion: 1,
    format: "sqlite_v1",
    activationId: `rsact_${contentHash(canonicalJson(evidence)).slice(7, 31)}`,
    evidence,
  };
}

export function readReportStorageCoordinate(
  value: unknown,
  projectId: string,
): ReportStorageCoordinate {
  const source = object(value, ["schemaVersion", "format", "activationId", "evidence"]);
  const coordinate = createReportStorageCoordinate(source.evidence);
  if (
    source.schemaVersion !== 1 ||
    source.format !== "sqlite_v1" ||
    source.activationId !== coordinate.activationId ||
    coordinate.evidence.projectId !== projectId
  )
    invalid();
  return coordinate;
}
