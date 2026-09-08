import { chmod, lstat, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { ManagedConversationResponseArtifactPort } from "@lervo/conversation-responder";
import type { WritingArtifactCoordinate } from "@lervo/writing";

function validArtifact(value: unknown): value is WritingArtifactCoordinate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const artifact = value as Partial<WritingArtifactCoordinate>;
  return (
    typeof artifact.artifactId === "string" &&
    /^art_[a-f0-9]{64}$/u.test(artifact.artifactId) &&
    typeof artifact.contentHash === "string" &&
    /^sha256:[a-f0-9]{64}$/u.test(artifact.contentHash) &&
    artifact.uri === `lervo-cas://sha256/${artifact.contentHash.slice(7)}` &&
    artifact.mediaType === "text/markdown; charset=utf-8" &&
    Number.isSafeInteger(artifact.byteCount) &&
    artifact.byteCount! >= 0 &&
    artifact.byteCount! <= 65_536
  );
}

export class SQLiteConversationResponseArtifactStore implements ManagedConversationResponseArtifactPort {
  private closed = false;

  private constructor(
    private readonly database: DatabaseSync,
    private readonly maxRecords: number,
  ) {}

  static async open(
    path: string,
    maxRecords = 1_024,
  ): Promise<SQLiteConversationResponseArtifactStore> {
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 100_000) {
      throw new Error("The conversation response artifact capacity is invalid.");
    }
    const absolute = resolve(path);
    await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
    try {
      const info = await lstat(absolute);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error("The conversation response artifact path is invalid.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const database = new DatabaseSync(absolute);
    try {
      database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS response_artifacts (
          request_digest TEXT PRIMARY KEY,
          artifact_json TEXT NOT NULL,
          created_at_ms INTEGER NOT NULL
        ) STRICT;
      `);
      await chmod(absolute, 0o600);
      return new SQLiteConversationResponseArtifactStore(database, maxRecords);
    } catch (error) {
      database.close();
      throw error;
    }
  }

  async get(requestDigest: string): Promise<WritingArtifactCoordinate | null> {
    this.assertOpen();
    this.assertDigest(requestDigest);
    const row = this.database
      .prepare("SELECT artifact_json FROM response_artifacts WHERE request_digest = ?")
      .get(requestDigest) as { artifact_json: string } | undefined;
    if (row === undefined) return null;
    const artifact: unknown = JSON.parse(row.artifact_json);
    if (!validArtifact(artifact)) {
      throw new Error("The cached conversation response artifact is invalid.");
    }
    return artifact;
  }

  async put(input: Parameters<ManagedConversationResponseArtifactPort["put"]>[0]): Promise<void> {
    this.assertOpen();
    this.assertDigest(input.requestDigest);
    if (!validArtifact(input.artifact) || !Number.isFinite(Date.parse(input.createdAt))) {
      throw new Error("The conversation response artifact record is invalid.");
    }
    const artifactJson = JSON.stringify(input.artifact);
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const current = this.database
        .prepare("SELECT artifact_json FROM response_artifacts WHERE request_digest = ?")
        .get(input.requestDigest) as { artifact_json: string } | undefined;
      if (current !== undefined && current.artifact_json !== artifactJson) {
        throw new Error("The conversation response digest is bound to another artifact.");
      }
      if (current === undefined) {
        this.database
          .prepare(
            "INSERT INTO response_artifacts (request_digest, artifact_json, created_at_ms) VALUES (?, ?, ?)",
          )
          .run(input.requestDigest, artifactJson, Date.parse(input.createdAt));
      }
      this.database
        .prepare(
          `
            DELETE FROM response_artifacts WHERE request_digest IN (
              SELECT request_digest FROM response_artifacts
              ORDER BY created_at_ms ASC, request_digest ASC
              LIMIT MAX(0, (SELECT COUNT(*) FROM response_artifacts) - ?)
            )
          `,
        )
        .run(this.maxRecords);
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  async remove(requestDigest: string): Promise<void> {
    this.assertOpen();
    this.assertDigest(requestDigest);
    this.database
      .prepare("DELETE FROM response_artifacts WHERE request_digest = ?")
      .run(requestDigest);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }

  private assertDigest(requestDigest: string): void {
    if (!/^sha256:[a-f0-9]{64}$/u.test(requestDigest)) {
      throw new Error("The conversation response request digest is invalid.");
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("The conversation response artifact store is closed.");
  }
}
