import { chmod, lstat, mkdir } from "node:fs/promises";
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
}
