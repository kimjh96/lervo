import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { resolveRepositoryCoordinationHome } from "./coordination-home.js";
import {
  ProjectStorageError,
  type RepositoryCoordinationCollection,
  type RepositoryCoordinationHome,
  type RepositoryCoordinationRecord,
} from "./types.js";

const RECORD_ID = /^[a-z][a-z0-9]{1,7}_[A-Za-z0-9_-]{8,128}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const MAXIMUM_RECORD_BYTES = 4 * 1024 * 1024;

function digest(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function targetDirectory(
  home: RepositoryCoordinationHome,
  collection: RepositoryCoordinationCollection,
): string {
  return home[collection];
}

function targetPath(
  home: RepositoryCoordinationHome,
  collection: RepositoryCoordinationCollection,
  recordId: string,
): string {
  if (!RECORD_ID.test(recordId))
    throw new ProjectStorageError(
      "coordination_home_invalid",
      "The repository coordination record ID is invalid.",
    );
  return resolve(targetDirectory(home, collection), `${recordId}.json`);
}

async function readContent(path: string): Promise<string | null> {
  try {
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > MAXIMUM_RECORD_BYTES ||
      (process.platform !== "win32" && (info.mode & 0o077) !== 0)
    )
      throw new ProjectStorageError(
        "coordination_home_invalid",
        "A repository coordination record is unsafe.",
      );
    return readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function acquireLock(home: RepositoryCoordinationHome, lockName: string) {
  const path = resolve(home.locks, `${lockName}.lock`);
  let handle;
  try {
    handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(
      `${JSON.stringify({ schemaVersion: 1, processId: process.pid, createdAt: new Date().toISOString() })}\n`,
    );
    await handle.sync();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new ProjectStorageError(
        "coordination_busy",
        "Another repository coordination transition is in progress.",
        { cause: error },
      );
    throw error;
  }
  return async () => {
    await handle.close();
    await rm(path, { force: true });
  };
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (process.platform !== "win32") await chmod(temporary, 0o600);
  await rename(temporary, path);
}

export class RepositoryCoordinationRecords {
  private constructor(readonly home: RepositoryCoordinationHome) {}

  static async open(repositoryRoot: string): Promise<RepositoryCoordinationRecords> {
    return new RepositoryCoordinationRecords(
      await resolveRepositoryCoordinationHome(repositoryRoot),
    );
  }

  async read<T>(
    collection: RepositoryCoordinationCollection,
    recordId: string,
  ): Promise<RepositoryCoordinationRecord<T> | null> {
    const content = await readContent(targetPath(this.home, collection, recordId));
    if (content === null) return null;
    let value: T;
    try {
      value = JSON.parse(content) as T;
    } catch (error) {
      throw new ProjectStorageError(
        "coordination_home_invalid",
        "A repository coordination record contains invalid JSON.",
        { cause: error },
      );
    }
    return { value, contentHash: digest(content) };
  }

  async write<T>(input: {
    collection: RepositoryCoordinationCollection;
    recordId: string;
    value: T;
    expectedContentHash: string | null;
  }): Promise<RepositoryCoordinationRecord<T>> {
    if (input.expectedContentHash !== null && !HASH.test(input.expectedContentHash))
      throw new ProjectStorageError(
        "coordination_state_conflict",
        "The expected repository coordination content hash is invalid.",
      );
    const path = targetPath(this.home, input.collection, input.recordId);
    const release = await acquireLock(this.home, `${input.collection}-${input.recordId}`);
    try {
      const current = await readContent(path);
      const currentHash = current === null ? null : digest(current);
      if (currentHash !== input.expectedContentHash)
        throw new ProjectStorageError(
          "coordination_state_conflict",
          "The repository coordination record changed before apply.",
        );
      const content = `${JSON.stringify(input.value, null, 2)}\n`;
      if (Buffer.byteLength(content) > MAXIMUM_RECORD_BYTES)
        throw new ProjectStorageError(
          "coordination_home_invalid",
          "The repository coordination record exceeds the size limit.",
        );
      await atomicWrite(path, content);
      return { value: structuredClone(input.value), contentHash: digest(content) };
    } finally {
      await release();
    }
  }

  async writeTransition<T, E>(input: {
    collection: Exclude<RepositoryCoordinationCollection, "events">;
    recordId: string;
    value: T;
    expectedContentHash: string | null;
    eventId: string;
    event: E;
  }): Promise<RepositoryCoordinationRecord<T>> {
    const path = targetPath(this.home, input.collection, input.recordId);
    const eventPath = targetPath(this.home, "events", input.eventId);
    const release = await acquireLock(this.home, `${input.collection}-${input.recordId}`);
    try {
      const [current, existingEvent] = await Promise.all([
        readContent(path),
        readContent(eventPath),
      ]);
      const currentHash = current === null ? null : digest(current);
      if (currentHash !== input.expectedContentHash || existingEvent !== null)
        throw new ProjectStorageError(
          "coordination_state_conflict",
          "The repository coordination transition changed before apply.",
        );
      const content = `${JSON.stringify(input.value, null, 2)}\n`;
      const eventContent = `${JSON.stringify(input.event, null, 2)}\n`;
      if (
        Buffer.byteLength(content) > MAXIMUM_RECORD_BYTES ||
        Buffer.byteLength(eventContent) > MAXIMUM_RECORD_BYTES
      )
        throw new ProjectStorageError(
          "coordination_home_invalid",
          "The repository coordination transition exceeds the size limit.",
        );
      await atomicWrite(path, content);
      try {
        await atomicWrite(eventPath, eventContent);
      } catch (error) {
        if (current === null) await rm(path, { force: true });
        else await atomicWrite(path, current);
        throw error;
      }
      return { value: structuredClone(input.value), contentHash: digest(content) };
    } finally {
      await release();
    }
  }

  async remove(input: {
    collection: Exclude<RepositoryCoordinationCollection, "events">;
    recordId: string;
    expectedContentHash: string;
  }): Promise<boolean> {
    if (!HASH.test(input.expectedContentHash))
      throw new ProjectStorageError(
        "coordination_state_conflict",
        "The expected repository coordination content hash is invalid.",
      );
    const path = targetPath(this.home, input.collection, input.recordId);
    const release = await acquireLock(this.home, `${input.collection}-${input.recordId}`);
    try {
      const current = await readContent(path);
      if (current === null) return false;
      if (digest(current) !== input.expectedContentHash)
        throw new ProjectStorageError(
          "coordination_state_conflict",
          "The repository coordination record changed before removal.",
        );
      await rm(path);
      return true;
    } finally {
      await release();
    }
  }

  async list<T>(
    collection: RepositoryCoordinationCollection,
  ): Promise<RepositoryCoordinationRecord<T>[]> {
    const directory = targetDirectory(this.home, collection);
    const names = (await readdir(directory))
      .filter((name) => RECORD_ID.test(name.slice(0, -5)) && name.endsWith(".json"))
      .sort();
    const records = await Promise.all(
      names.map((name) => this.read<T>(collection, name.slice(0, -5))),
    );
    return records.filter((record): record is RepositoryCoordinationRecord<T> => record !== null);
  }
}
