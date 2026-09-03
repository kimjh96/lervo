import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { contentHash, readEntry } from "./filesystem.js";
import { EventWriterActivationError } from "./event-writer-errors.js";

export const eventWriterActivationTransactionName = ".event-contract-activation";
export const maximumEventWriterCoordinateBytes = 64 * 1024;

export interface EventWriterActivationJournal {
  schemaVersion: 1;
  transactionKind: "event_writer_selection";
  planId: string;
  projectId: string;
  beforeHash: string | null;
  afterHash: string;
}

export function supportsEventWriterDirectorySync(platform: NodeJS.Platform): boolean {
  return platform !== "win32";
}

export async function syncEventWriterDirectory(path: string): Promise<void> {
  // Windows does not support fsync on directory handles; file contents are still synced before rename.
  if (!supportsEventWriterDirectorySync(process.platform)) return;
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeDurableEventWriterFile(path: string, content: string): Promise<void> {
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncEventWriterDirectory(dirname(path));
}

export async function ensureEventWriterDataDirectory(path: string): Promise<void> {
  const entry = await readEntry(path);
  if (entry.kind === "missing") {
    await mkdir(path, { recursive: false, mode: 0o700 });
    await syncEventWriterDirectory(dirname(path));
    return;
  }
  if (entry.kind !== "directory") {
    throw new EventWriterActivationError(
      "event_writer_coordinate_invalid",
      "The Lervo data path must be a real directory.",
    );
  }
}

export async function assertNoEventWriterActivationTransaction(dataPath: string): Promise<void> {
  if (
    (await readEntry(resolve(dataPath, eventWriterActivationTransactionName))).kind !== "missing"
  ) {
    throw new EventWriterActivationError(
      "event_writer_recovery_required",
      "Recover the pending event writer activation before reading or planning writer state.",
    );
  }
}

export function readEventWriterActivationJournal(value: unknown): EventWriterActivationJournal {
  const source = value as Partial<EventWriterActivationJournal>;
  const allowed = [
    "schemaVersion",
    "transactionKind",
    "planId",
    "projectId",
    "beforeHash",
    "afterHash",
  ];
  if (
    source?.schemaVersion !== 1 ||
    source.transactionKind !== "event_writer_selection" ||
    typeof source.planId !== "string" ||
    !/^evplan_[a-f0-9]{24}$/u.test(source.planId) ||
    typeof source.projectId !== "string" ||
    !/^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(source.projectId) ||
    (source.beforeHash !== null &&
      (typeof source.beforeHash !== "string" ||
        !/^sha256:[a-f0-9]{64}$/u.test(source.beforeHash))) ||
    typeof source.afterHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(source.afterHash) ||
    Object.keys(source).some((key) => !allowed.includes(key))
  ) {
    throw new EventWriterActivationError(
      "event_writer_recovery_required",
      "The event writer activation recovery journal is invalid.",
    );
  }
  return source as EventWriterActivationJournal;
}

export async function eventWriterFileHash(path: string): Promise<string | null> {
  const entry = await readEntry(path, maximumEventWriterCoordinateBytes);
  if (entry.kind === "missing") return null;
  if (entry.kind !== "file") {
    throw new EventWriterActivationError(
      "event_writer_recovery_required",
      "An event writer activation recovery file is unsafe.",
    );
  }
  return contentHash(entry.content);
}
