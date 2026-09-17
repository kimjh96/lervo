import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

interface ConversationEventCursorSnapshot {
  schemaVersion: 1;
  cursorKind: string;
  projectId: string;
  integrationId: string;
  afterSeq: number;
  updatedAt: string;
}

/** Atomic owner-local cursor for one named canonical-event projection. */
export class FileConversationEventCursor {
  private readonly path: string;

  constructor(
    path: string,
    private readonly coordinates: {
      cursorKind: string;
      projectId: string;
      integrationId: string;
    },
  ) {
    this.path = resolve(path);
    if (!/^[a-z][a-z0-9_.-]{0,63}$/u.test(coordinates.cursorKind)) {
      throw new Error("The conversation event cursor kind is invalid.");
    }
  }

  async read(): Promise<number | null> {
    let serialized: string;
    try {
      const metadata = await lstat(this.path);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("unsafe cursor");
      serialized = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const value = JSON.parse(serialized) as Partial<ConversationEventCursorSnapshot>;
    if (
      value.schemaVersion !== 1 ||
      value.cursorKind !== this.coordinates.cursorKind ||
      value.projectId !== this.coordinates.projectId ||
      value.integrationId !== this.coordinates.integrationId ||
      !Number.isSafeInteger(value.afterSeq) ||
      value.afterSeq! < 0 ||
      !Number.isFinite(Date.parse(value.updatedAt ?? ""))
    ) {
      throw new Error("The conversation event cursor is invalid.");
    }
    return value.afterSeq!;
  }

  async write(afterSeq: number, updatedAt: string): Promise<void> {
    if (
      !Number.isSafeInteger(afterSeq) ||
      afterSeq < 0 ||
      !Number.isFinite(Date.parse(updatedAt))
    ) {
      throw new Error("The conversation event cursor update is invalid.");
    }
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    const content = `${JSON.stringify({
      schemaVersion: 1,
      ...this.coordinates,
      afterSeq,
      updatedAt,
    } satisfies ConversationEventCursorSnapshot)}\n`;
    try {
      await writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporary, this.path);
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
}
