import { lstat, readFile, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { loadProjectManifest } from "./config.js";
import {
  eventWriterActivationTransactionName,
  eventWriterFileHash,
  readEventWriterActivationJournal,
  syncEventWriterDirectory,
  type EventWriterActivationJournal,
} from "./event-writer-activation-transaction-io.js";
import { EventWriterActivationError } from "./event-writer-errors.js";
import { resolveProjectPaths } from "./layout.js";

export async function recoverEventWriterActivation(repositoryRoot: string): Promise<{
  schemaVersion: 1;
  status: "current" | "completed" | "rolled_back";
  planId: string | null;
}> {
  const paths = resolveProjectPaths(repositoryRoot);
  const transaction = resolve(paths.data, eventWriterActivationTransactionName);
  try {
    const stats = await lstat(transaction);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("unsafe transaction");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { schemaVersion: 1, status: "current", planId: null };
    }
    throw new EventWriterActivationError(
      "event_writer_recovery_required",
      "The event writer activation transaction path is unsafe.",
      { cause: error },
    );
  }
  let journal: EventWriterActivationJournal;
  try {
    journal = readEventWriterActivationJournal(
      JSON.parse(await readFile(resolve(transaction, "journal.json"), "utf8")),
    );
  } catch (error) {
    if (error instanceof EventWriterActivationError) throw error;
    throw new EventWriterActivationError(
      "event_writer_recovery_required",
      "The event writer activation journal cannot be read.",
      { cause: error },
    );
  }
  const manifest = await loadProjectManifest(paths.repositoryRoot);
  if (journal.projectId !== manifest.projectId) {
    throw new EventWriterActivationError(
      "event_writer_recovery_required",
      "The event writer activation journal belongs to another project.",
    );
  }
  const targetHash = await eventWriterFileHash(paths.eventContract);
  const beforePath = resolve(transaction, "before.json");
  const beforeHash = await eventWriterFileHash(beforePath);
  if (targetHash === journal.afterHash) {
    await rm(transaction, { recursive: true });
    await syncEventWriterDirectory(paths.data);
    return { schemaVersion: 1, status: "completed", planId: journal.planId };
  }
  if (journal.beforeHash === null && targetHash === null && beforeHash === null) {
    await rm(transaction, { recursive: true });
    await syncEventWriterDirectory(paths.data);
    return { schemaVersion: 1, status: "rolled_back", planId: journal.planId };
  }
  if (journal.beforeHash !== null && targetHash === journal.beforeHash && beforeHash === null) {
    await rm(transaction, { recursive: true });
    await syncEventWriterDirectory(paths.data);
    return { schemaVersion: 1, status: "rolled_back", planId: journal.planId };
  }
  if (journal.beforeHash !== null && targetHash === null && beforeHash === journal.beforeHash) {
    await rename(beforePath, paths.eventContract);
    await syncEventWriterDirectory(paths.data);
    await rm(transaction, { recursive: true });
    await syncEventWriterDirectory(paths.data);
    return { schemaVersion: 1, status: "rolled_back", planId: journal.planId };
  }
  throw new EventWriterActivationError(
    "event_writer_recovery_required",
    "Event writer activation bytes do not match a safe completion or rollback state.",
  );
}
