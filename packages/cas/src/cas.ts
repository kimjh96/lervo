import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, unlink, type FileHandle } from "node:fs/promises";
import { createFileSyncBatch } from "@lervo/filesystem-durability";
import { resolve } from "node:path";

import { type ArtifactStore } from "@lervo/storage-contract";
import { CasError } from "./cas-error.js";
import { loadNativeCas, type NativeCasOperation, type NativeCasResult } from "./native-cas.js";
import { createNativeCasBatch } from "./native-cas-batch.js";
import { nativeCasError } from "./native-cas-error.js";

export { CasError, type CasErrorCode } from "./cas-error.js";

const uriPattern = /^lervo-cas:\/\/sha256\/([a-f0-9]{64})$/;

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
    throw new CasError("unsafe_path", `${path} must be a real directory.`);
  }
}

export class FileSystemCas implements ArtifactStore {
  readonly root: string;
  private sharedPuts = 0;
  private syncFilesValue: ReturnType<typeof createFileSyncBatch> | undefined;
  private syncFilesInitialized = false;
  private nativeIoValue: ReturnType<typeof createNativeCasBatch> | undefined;
  private nativeIoInitialized = false;
  private readonly pendingPuts = new Map<
    string,
    { bytes: Buffer; result: Promise<CasPutResult> }
  >();

  private constructor(
    root: string,
    private readonly readOnly = false,
  ) {
    this.root = root;
  }

  private get syncFiles(): ReturnType<typeof createFileSyncBatch> | undefined {
    if (this.readOnly) return undefined;
    if (!this.syncFilesInitialized) {
      this.syncFilesValue = createFileSyncBatch();
      this.syncFilesInitialized = true;
    }
    return this.syncFilesValue;
  }

  private get nativeIo(): ReturnType<typeof createNativeCasBatch> | undefined {
    if (!this.nativeIoInitialized) {
      const native = loadNativeCas();
      this.nativeIoValue = native ? createNativeCasBatch(native) : undefined;
      this.nativeIoInitialized = true;
    }
    return this.nativeIoValue;
  }

  static async open(root: string): Promise<FileSystemCas> {
    const absoluteRoot = resolve(root);
    await ensureRealDirectory(absoluteRoot);
    await ensureRealDirectory(resolve(absoluteRoot, "sha256"));
    await ensureRealDirectory(resolve(absoluteRoot, ".tmp"));
    return new FileSystemCas(absoluteRoot);
  }

  static async openReadOnly(root: string): Promise<FileSystemCas> {
    const absoluteRoot = resolve(root);
    for (const path of [
      absoluteRoot,
      resolve(absoluteRoot, "sha256"),
      resolve(absoluteRoot, ".tmp"),
    ]) {
      const stats = await lstat(path);
      if (!stats.isDirectory() || stats.isSymbolicLink())
        throw new CasError("unsafe_path", "A read-only CAS requires existing real directories.");
    }
    return new FileSystemCas(absoluteRoot, true);
  }

  private objectPath(hash: string): string {
    return resolve(this.root, "sha256", hash.slice(0, 2), hash.slice(2));
  }

  private hashFromUri(uri: string): string {
    const match = uriPattern.exec(uri);
    const hash = match?.[1];
    if (!hash) {
      throw new CasError("invalid_uri", `Unsupported CAS URI: ${uri}`);
    }
    return hash;
  }

  private async verifyObject(hash: string, observed?: NativeCasResult): Promise<Uint8Array> {
    const path = this.objectPath(hash);
    const operation: NativeCasOperation = [path];
    const result = observed ?? (this.nativeIo ? await this.nativeIo(operation) : undefined);
    if (result?.status === "failed") throw nativeCasError(operation, result, uriForDigest(hash));
    const bytes = result?.status === "complete" ? result.bytes : await this.readOrdinary(hash);
    if (digest(bytes) !== hash) {
      throw new CasError("corrupt_object", `CAS object hash mismatch: ${uriForDigest(hash)}`);
    }
    return bytes;
  }

  private async readOrdinary(hash: string): Promise<Buffer> {
    const path = this.objectPath(hash);
    let stats;
    try {
      stats = await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new CasError("not_found", `CAS object not found: ${uriForDigest(hash)}`);
      }
      throw error;
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new CasError("unsafe_path", "A CAS object must be a regular file.");
    }
    return readFile(path);
  }

  private async publishObject(
    temporary: string,
    hash: string,
    nativeAllowed: boolean,
  ): Promise<boolean> {
    const prefix = resolve(this.root, "sha256", hash.slice(0, 2));
    const target = this.objectPath(hash);
    const operation: NativeCasOperation = [temporary, prefix, target];
    const result = nativeAllowed && this.nativeIo ? await this.nativeIo(operation) : undefined;
    if (result?.status === "failed") {
      const error = nativeCasError(operation, result, uriForDigest(hash));
      // mkdir failed before linking. Preserve the existing recursive-parent behavior.
      if (!(
        result.syscall === "mkdir" &&
        result.pathIndex === 1 &&
        !result.created &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ))
        throw error;
    } else if (result) {
      await this.verifyObject(hash, result);
      return result.created;
    }
    await ensureRealDirectory(prefix);
    let created = false;
    try {
      await link(temporary, target);
      created = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await this.verifyObject(hash);
    return created;
  }

  async put(content: string | Uint8Array): Promise<CasPutResult> {
    const byteCount = typeof content === "string" ? Buffer.byteLength(content) : content.byteLength;
    if (byteCount > 65536 || this.sharedPuts >= 16) return this.putUnshared(content);
    const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
    const hash = digest(bytes);
    this.sharedPuts += 1;
    try {
      const pending = this.pendingPuts.get(hash);
      if (pending) {
        if (!pending.bytes.equals(bytes))
          throw new CasError("corrupt_object", "Concurrent CAS inputs disagree at one digest.");
        const result = await pending.result;
        const prefix = await lstat(resolve(this.root, "sha256", hash.slice(0, 2)));
        if (!prefix.isDirectory() || prefix.isSymbolicLink())
          throw new CasError("unsafe_path", "A shared CAS prefix must remain a real directory.");
        const current = await this.verifyObject(hash);
        if (!bytes.equals(current))
          throw new CasError(
            "corrupt_object",
            "The shared CAS object no longer matches its input.",
          );
        return { ...result, created: false };
      }
      const result = this.putUnshared(bytes);
      this.pendingPuts.set(hash, { bytes, result });
      try {
        return { ...(await result) };
      } finally {
        this.pendingPuts.delete(hash);
      }
    } finally {
      this.sharedPuts -= 1;
    }
  }

  private putUnshared(content: string | Uint8Array): Promise<CasPutResult> {
    const bytes = typeof content === "string" ? Buffer.byteLength(content) : content.byteLength;
    return this.writeStream(
      (async function* (): AsyncIterable<string | Uint8Array> {
        yield content;
      })(),
      bytes <= 65536 ? this.syncFiles : undefined,
    );
  }

  putStream(chunks: AsyncIterable<string | Uint8Array>): Promise<CasPutResult> {
    return this.writeStream(chunks);
  }

  private async writeStream(
    chunks: AsyncIterable<string | Uint8Array>,
    synchronize?: ReturnType<typeof createFileSyncBatch>,
  ): Promise<CasPutResult> {
    if (this.readOnly)
      throw new CasError(
        "read_only",
        "This artifact handle cannot mutate the observed repository.",
      );
    const temporary = resolve(this.root, ".tmp", `${randomUUID()}.tmp`);
    let handle: FileHandle | undefined;
    const hashState = createHash("sha256");
    let byteCount = 0;
    const prepare = async () => {
      handle = await open(temporary, "wx");
      for await (const chunk of chunks) {
        const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
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
            throw new Error("The CAS temporary-file write made no progress.");
          }
          offset += bytesWritten;
        }
      }
      return handle;
    };
    try {
      if (synchronize) handle = await synchronize(prepare);
      else {
        handle = await prepare();
        await handle.sync();
      }
      await handle.close();
      const hash = hashState.digest("hex");
      const created = await this.publishObject(temporary, hash, synchronize !== undefined);
      return {
        uri: uriForDigest(hash),
        contentHash: `sha256:${hash}`,
        byteCount,
        created,
      };
    } finally {
      if (handle) {
        await handle.close().catch(() => undefined);
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
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
