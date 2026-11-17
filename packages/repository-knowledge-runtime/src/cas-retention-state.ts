import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { ReferenceScan } from "./cas-retention-files.js";
import { CasRetentionBoundError } from "./cas-retention-budget.js";
import { readPrivateJsonFile } from "./private-state-file.js";

const MAXIMUM_STATE_BYTES = 32 * 1024 * 1024;

export interface RetentionReportScan {
  referenceSeq: number;
  references: string[] | null;
}

export interface RetentionScan {
  schemaVersion: 1;
  nextScanAt: number;
  eligible: string[];
  files: Record<string, ReferenceScan>;
  reports: Record<string, RetentionReportScan>;
}

function validScan(value: unknown): value is RetentionScan {
  if (!value || typeof value !== "object") return false;
  const scan = value as RetentionScan;
  return (
    scan.schemaVersion === 1 &&
    Number.isFinite(scan.nextScanAt) &&
    Array.isArray(scan.eligible) &&
    scan.eligible.length <= 100_000 &&
    scan.eligible.every((hash) => /^[a-f0-9]{64}$/u.test(hash)) &&
    scan.reports !== null &&
    typeof scan.reports === "object" &&
    Object.keys(scan.reports).length <= 200_000 &&
    Object.values(scan.reports).every(
      (report) =>
        report !== null &&
        Number.isSafeInteger(report.referenceSeq) &&
        report.referenceSeq >= 0 &&
        (report.references === null ||
          (Array.isArray(report.references) &&
            report.references.every((hash) => /^[a-f0-9]{64}$/u.test(hash)))),
    ) &&
    scan.files !== null &&
    typeof scan.files === "object" &&
    Object.keys(scan.files).length <= 100_000 &&
    Object.values(scan.files).every(
      (file) =>
        typeof file.identity === "string" &&
        typeof file.complete === "boolean" &&
        (file.sqlite === undefined ||
          (Number.isSafeInteger(file.sqlite.table) &&
            file.sqlite.table >= 0 &&
            Number.isSafeInteger(file.sqlite.row) &&
            file.sqlite.row >= 0)) &&
        Number.isSafeInteger(file.offset) &&
        file.offset >= 0 &&
        typeof file.tail === "string" &&
        file.tail.length <= 96 &&
        Array.isArray(file.references) &&
        file.references.every((hash) => /^[a-f0-9]{64}$/u.test(hash)),
    )
  );
}

export async function readRetentionScan(path: string): Promise<RetentionScan> {
  const previous = await readPrivateJsonFile(path, MAXIMUM_STATE_BYTES);
  const cached =
    previous.status === "read" ? (previous.value as { scan?: unknown; checksum?: unknown }) : null;
  return cached && validScan(cached.scan) && cached.checksum === scanChecksum(cached.scan)
    ? cached.scan
    : { schemaVersion: 1, nextScanAt: 0, eligible: [], files: {}, reports: {} };
}

export async function saveScan(path: string, scan: RetentionScan): Promise<void> {
  if (Buffer.byteLength(JSON.stringify(scan)) + 256 > MAXIMUM_STATE_BYTES)
    throw new CasRetentionBoundError("CAS retention scan exceeds its bound.");
  await writeRetentionProjection(path, { scan, checksum: scanChecksum(scan) });
}

function scanChecksum(scan: RetentionScan): string {
  return createHash("sha256").update(JSON.stringify(scan)).digest("hex");
}

/** Fixed owned temporary names keep interrupted projections out of the reference root inventory. */
export async function writeRetentionProjection(path: string, value: unknown): Promise<void> {
  if (!/^cas-retention-(?:scan|observation)\.json$/u.test(basename(path)))
    throw new Error("Invalid retention projection path.");
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Invalid retention projection directory.");
  const temporary = resolve(directory, `${basename(path)}.next`);
  await rm(temporary, { force: true });
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
