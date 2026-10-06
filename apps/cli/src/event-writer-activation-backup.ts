import { randomUUID } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { resolveProjectPaths } from "@lervo/project";

/** Repository-relative root of the bounded pre-activation backups: one directory per target. */
export const EVENT_WRITER_BACKUP_DIRECTORY = ".lervo/data/event-writer-backups";

export interface EventWriterActivationBackup {
  /** Repository-relative directory holding the latest backup for this target version. */
  path: string;
  eventDatabase: "copied" | "absent";
  coordinate: "copied" | "absent";
}

async function exists(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw Object.assign(new Error("An event writer backup source is not a regular file."), {
        code: "event_writer_backup_failed",
      });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * ADR-0470: makes the event database and writer coordinate recoverable before an automatic
 * activation, as the local-only activation procedure requires. `VACUUM INTO` writes a
 * transactionally consistent snapshot even while another process appends, so writers need not
 * stop. Each target version keeps only its latest backup, which bounds growth.
 */
export async function createEventWriterActivationBackup(input: {
  repositoryRoot: string;
  targetEventSchemaVersion: number;
  planId: string;
  now: Date;
}): Promise<EventWriterActivationBackup> {
  const paths = resolveProjectPaths(input.repositoryRoot);
  const relative = `${EVENT_WRITER_BACKUP_DIRECTORY}/schema-${input.targetEventSchemaVersion}`;
  const parent = resolve(input.repositoryRoot, EVENT_WRITER_BACKUP_DIRECTORY);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const preparing = resolve(parent, `.preparing-${randomUUID()}`);
  await mkdir(preparing, { mode: 0o700 });
  try {
    const database = (await exists(paths.eventDatabase)) ? "copied" : "absent";
    if (database === "copied") {
      const target = resolve(preparing, "events.sqlite");
      const source = new DatabaseSync(paths.eventDatabase, { readOnly: true });
      try {
        source.exec("PRAGMA busy_timeout=5000");
        source.prepare("VACUUM INTO ?").run(target);
      } finally {
        source.close();
      }
      await chmod(target, 0o600);
    }
    const coordinate = (await exists(paths.eventContract)) ? "copied" : "absent";
    if (coordinate === "copied") {
      await copyFile(paths.eventContract, resolve(preparing, "event-contract.json"));
      await chmod(resolve(preparing, "event-contract.json"), 0o600);
    }
    await writeFile(
      resolve(preparing, "backup.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          kind: "event_writer_activation_backup",
          createdAt: input.now.toISOString(),
          planId: input.planId,
          targetEventSchemaVersion: input.targetEventSchemaVersion,
          eventDatabase: database,
          coordinate,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600, flag: "wx" },
    );
    const destination = resolve(input.repositoryRoot, relative);
    await rm(destination, { recursive: true, force: true });
    await rename(preparing, destination);
    return { path: relative, eventDatabase: database, coordinate };
  } catch (error) {
    await rm(preparing, { recursive: true, force: true });
    throw Object.assign(
      new Error("The event database could not be backed up before activation.", { cause: error }),
      { code: "event_writer_backup_failed" },
    );
  }
}
