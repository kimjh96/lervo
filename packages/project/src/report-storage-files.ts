import { constants } from "node:fs";
import { link, open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { syncDirectory } from "@lervo/filesystem-durability";
import { readSmallEntry } from "./small-entry.js";
import { readEntry, contentHash } from "./filesystem.js";
import { readReportStorageCoordinate, ReportStorageError } from "./report-storage-contract.js";

const maximumBytes = 64 * 1024;
export function reportStoragePaths(data: string) {
  return {
    current: resolve(data, "report-storage.json"),
    pending: resolve(data, ".report-storage-pending"),
  };
}
export async function readReportStorageFile(path: string, projectId: string) {
  const entry = await readSmallEntry(path, maximumBytes);
  if (entry.kind === "missing") return null;
  if (entry.kind !== "file")
    throw new ReportStorageError(
      "report_storage_invalid",
      "Report storage selection must be a bounded regular file.",
    );
  try {
    return {
      coordinate: readReportStorageCoordinate(JSON.parse(entry.content), projectId),
      content: entry.content,
      contentHash: contentHash(entry.content),
    };
  } catch (error) {
    throw new ReportStorageError(
      "report_storage_invalid",
      "Report storage selection cannot be verified.",
      { cause: error },
    );
  }
}
async function assertReportStorageDirectory(data: string): Promise<void> {
  const entry = await readSmallEntry(data);
  if (entry.kind !== "missing" && entry.kind !== "directory")
    throw new ReportStorageError(
      "report_storage_invalid",
      "Report storage requires a real data directory.",
    );
}
export async function assertReportStorageIdle(data: string): Promise<void> {
  await assertReportStorageDirectory(data);
  if ((await readEntry(reportStoragePaths(data).pending, maximumBytes)).kind !== "missing")
    throw new ReportStorageError(
      "report_storage_recovery_required",
      "Recover pending report storage selection first.",
    );
}

/** Publish once without replacing an existing owner file; a pending record fences interrupted work. */
export async function publishReportStorageSelection(input: {
  data: string;
  projectId: string;
  content: string;
  checkpoint?: (phase: "staged" | "published") => void | Promise<void>;
}): Promise<void> {
  await assertReportStorageDirectory(input.data);
  const paths = reportStoragePaths(input.data);
  const handle = await open(
    paths.pending,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    await handle.writeFile(input.content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(input.data);
  await input.checkpoint?.("staged");
  const pending = await readReportStorageFile(paths.pending, input.projectId);
  if (pending?.contentHash !== contentHash(input.content))
    throw new ReportStorageError(
      "report_storage_recovery_required",
      "The staged report selection changed.",
    );
  await link(paths.pending, paths.current);
  await syncDirectory(input.data);
  await input.checkpoint?.("published");
  const published = await readReportStorageFile(paths.current, input.projectId);
  if (published?.contentHash !== pending.contentHash)
    throw new ReportStorageError(
      "report_storage_recovery_required",
      "The published report selection changed.",
    );
  await unlink(paths.pending);
  await syncDirectory(input.data);
}

export async function finishReportStoragePublication(
  data: string,
  projectId: string,
): Promise<void> {
  await assertReportStorageDirectory(data);
  const paths = reportStoragePaths(data);
  const pending = await readReportStorageFile(paths.pending, projectId);
  if (!pending) return;
  const current = await readReportStorageFile(paths.current, projectId);
  if (current && current.contentHash !== pending.contentHash)
    throw new ReportStorageError(
      "report_storage_recovery_required",
      "Report storage publication conflicts with an existing selection.",
    );
  if (!current) await link(paths.pending, paths.current);
  await syncDirectory(data);
  await unlink(paths.pending);
  await syncDirectory(data);
}
