import { chmod, lstat, mkdir, open, opendir, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";

import type { ArtifactPutResult, ArtifactStore } from "@lervo/storage-contract";

import { CasError, FileSystemCas } from "./cas.js";

const URI_PATTERN = /^lervo-cas:\/\/sha256\/([a-f0-9]{64})$/u;

async function secureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stats = await lstat(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new CasError("unsafe_path", `${path}은 실제 디렉터리여야 합니다.`);
  }
  await chmod(path, 0o700);
}

/** Filesystem CAS adapter for raw content that must not be group/world-readable. */
export class OwnerOnlyFileSystemCas implements ArtifactStore {
  readonly root: string;

  private constructor(root: string, private readonly delegate: FileSystemCas) {
    this.root = root;
  }

  static async open(root: string): Promise<OwnerOnlyFileSystemCas> {
    const absoluteRoot = resolve(root);
    await secureDirectory(absoluteRoot);
    await secureDirectory(resolve(absoluteRoot, "sha256"));
    await secureDirectory(resolve(absoluteRoot, ".tmp"));
    return new OwnerOnlyFileSystemCas(absoluteRoot, await FileSystemCas.open(absoluteRoot));
  }

  private async secure(result: ArtifactPutResult): Promise<ArtifactPutResult> {
    const hash = URI_PATTERN.exec(result.uri)?.[1];
    if (hash === undefined) throw new CasError("invalid_uri", "CAS가 지원하지 않는 URI를 반환했습니다.");
    const prefix = resolve(this.root, "sha256", hash.slice(0, 2));
    await secureDirectory(prefix);
    await chmod(resolve(prefix, hash.slice(2)), 0o600);
    return result;
  }

  async put(content: string | Uint8Array): Promise<ArtifactPutResult> {
    return this.secure(await this.delegate.put(content));
  }

  async putStream(chunks: AsyncIterable<string | Uint8Array>): Promise<ArtifactPutResult> {
    return this.secure(await this.delegate.putStream(chunks));
  }

  get(uri: string): Promise<Uint8Array> {
    return this.delegate.get(uri);
  }

  has(uri: string): Promise<boolean> {
    return this.delegate.has(uri);
  }

  async listObjects(options: {
    after?: string;
    limit?: number;
    maximumScannedObjects?: number;
  } = {}): Promise<{
    items: Array<{ uri: string; byteCount: number; modifiedAt: string }>;
    nextCursor: string | null;
  }> {
    const limit = options.limit ?? 100;
    const maximumScannedObjects = options.maximumScannedObjects ?? 100_000;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000 ||
      !Number.isSafeInteger(maximumScannedObjects) || maximumScannedObjects < limit ||
      maximumScannedObjects > 1_000_000) {
      throw new CasError("capacity_exceeded", "CAS inventory 조회 상한이 유효하지 않습니다.");
    }
    const afterHash = options.after === undefined ? "" : URI_PATTERN.exec(options.after)?.[1];
    if (afterHash === undefined) throw new CasError("invalid_uri", "CAS inventory cursor가 유효하지 않습니다.");
    const selected: string[] = [];
    let scanned = 0;
    const root = await opendir(resolve(this.root, "sha256"));
    for await (const prefixEntry of root) {
      if (!/^[a-f0-9]{2}$/.test(prefixEntry.name) || !prefixEntry.isDirectory()) {
        throw new CasError("unsafe_path", "CAS inventory prefix가 안전한 실제 디렉터리가 아닙니다.");
      }
      const directory = await opendir(resolve(this.root, "sha256", prefixEntry.name));
      for await (const objectEntry of directory) {
        scanned += 1;
        if (scanned > maximumScannedObjects) {
          throw new CasError("capacity_exceeded", "CAS inventory가 허용된 scan 상한을 넘었습니다.");
        }
        const hash = `${prefixEntry.name}${objectEntry.name}`;
        if (!/^[a-f0-9]{64}$/.test(hash) || !objectEntry.isFile()) {
          throw new CasError("unsafe_path", "CAS inventory object가 안전한 일반 파일이 아닙니다.");
        }
        if (hash <= afterHash) continue;
        selected.push(hash);
        selected.sort();
        if (selected.length > limit + 1) selected.pop();
      }
    }
    const page = selected.slice(0, limit);
    const items = await Promise.all(page.map(async (hash) => {
      const uri = `lervo-cas://sha256/${hash}`;
      const bytes = await this.delegate.get(uri);
      const metadata = await stat(resolve(this.root, "sha256", hash.slice(0, 2), hash.slice(2)));
      return { uri, byteCount: bytes.byteLength, modifiedAt: metadata.mtime.toISOString() };
    }));
    return {
      items,
      nextCursor: selected.length > limit ? items.at(-1)!.uri : null,
    };
  }

  async deleteObject(uri: string): Promise<{ deleted: boolean }> {
    const hash = URI_PATTERN.exec(uri)?.[1];
    if (hash === undefined) throw new CasError("invalid_uri", "삭제할 CAS URI가 유효하지 않습니다.");
    const prefix = resolve(this.root, "sha256", hash.slice(0, 2));
    const path = resolve(prefix, hash.slice(2));
    try {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new CasError("unsafe_path", "삭제할 CAS object가 안전한 일반 파일이 아닙니다.");
      }
      await unlink(path);
      const directory = await open(prefix, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      return { deleted: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { deleted: false };
      throw error;
    }
  }
}
