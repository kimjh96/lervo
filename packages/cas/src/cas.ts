import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";

import { type ArtifactStore } from "@lervo/storage-contract";

const uriPattern = /^lervo-cas:\/\/sha256\/([a-f0-9]{64})$/;

export type CasErrorCode =
  | "capacity_exceeded"
  | "corrupt_object"
  | "invalid_uri"
  | "not_found"
  | "unsafe_path";

export class CasError extends Error {
  constructor(
    readonly code: CasErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CasError";
  }
}

export interface CasPutResult {
  uri: string;
  contentHash: string;
  byteCount: number;
  created: boolean;
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function uriForDigest(hash: string): string {
  return `lervo-cas://sha256/${hash}`;
}

async function ensureRealDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  const stats = await lstat(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new CasError("unsafe_path", `${path}은 실제 디렉터리여야 합니다.`);
  }
}

export class FileSystemCas implements ArtifactStore {
  readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  static async open(root: string): Promise<FileSystemCas> {
    const absoluteRoot = resolve(root);
    await ensureRealDirectory(absoluteRoot);
    await ensureRealDirectory(resolve(absoluteRoot, "sha256"));
    await ensureRealDirectory(resolve(absoluteRoot, ".tmp"));
    return new FileSystemCas(absoluteRoot);
  }

  private objectPath(hash: string): string {
    return resolve(this.root, "sha256", hash.slice(0, 2), hash.slice(2));
  }

  private hashFromUri(uri: string): string {
    const match = uriPattern.exec(uri);
    const hash = match?.[1];
    if (!hash) {
      throw new CasError("invalid_uri", `지원하지 않는 CAS URI입니다: ${uri}`);
    }
    return hash;
  }

  private async verifyObject(hash: string): Promise<Uint8Array> {
    const path = this.objectPath(hash);
    let stats;
    try {
      stats = await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new CasError("not_found", `CAS object가 없습니다: ${uriForDigest(hash)}`);
      }
      throw error;
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new CasError("unsafe_path", "CAS object는 일반 파일이어야 합니다.");
    }
    const bytes = await readFile(path);
    if (digest(bytes) !== hash) {
      throw new CasError(
        "corrupt_object",
        `CAS object hash가 일치하지 않습니다: ${uriForDigest(hash)}`,
      );
    }
    return bytes;
  }

  async put(content: string | Uint8Array): Promise<CasPutResult> {
    return this.putStream(
      (async function* (): AsyncIterable<string | Uint8Array> {
        yield content;
      })(),
    );
  }

  async putStream(chunks: AsyncIterable<string | Uint8Array>): Promise<CasPutResult> {
    const temporary = resolve(this.root, ".tmp", `${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx");
    const hashState = createHash("sha256");
    let byteCount = 0;
    let created = false;
    try {
      for await (const chunk of chunks) {
        const bytes =
          typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
        hashState.update(bytes);
        byteCount += bytes.byteLength;
        let offset = 0;
        while (offset < bytes.byteLength) {
          const { bytesWritten } = await handle.write(
            bytes,
            offset,
            bytes.byteLength - offset,
            null,
          );
          if (bytesWritten === 0) {
            throw new Error("CAS 임시 파일 쓰기가 진행되지 않았습니다.");
          }
          offset += bytesWritten;
        }
      }
      await handle.sync();
      await handle.close();
      const hash = hashState.digest("hex");
      const prefixDirectory = resolve(this.root, "sha256", hash.slice(0, 2));
      await ensureRealDirectory(prefixDirectory);
      const target = this.objectPath(hash);
      try {
        await link(temporary, target);
        created = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
      }
      await this.verifyObject(hash);
      return {
        uri: uriForDigest(hash),
        contentHash: `sha256:${hash}`,
        byteCount,
        created,
      };
    } finally {
      await handle.close().catch(() => undefined);
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }

  async get(uri: string): Promise<Uint8Array> {
    return this.verifyObject(this.hashFromUri(uri));
  }

  async has(uri: string): Promise<boolean> {
    const hash = this.hashFromUri(uri);
    try {
      await this.verifyObject(hash);
      return true;
    } catch (error) {
      if (error instanceof CasError && error.code === "not_found") {
        return false;
      }
      throw error;
    }
  }
}
