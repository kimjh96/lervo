import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { sameFileIdentityAcrossStatSurfaces } from "./file-identity.js";
import {
  isRuntimeModuleName,
  runtimeModuleHash,
  runtimeModuleManifest,
  runtimeModuleManifestMaximumBytes,
  runtimeModuleMaximumBytes,
  validateRuntimeModuleManifest,
} from "./runtime-module-contract.js";

export interface RuntimeModuleArtifact {
  files: ReadonlyMap<string, Buffer>;
  hash: string;
}

/** Capture regular files without following links or allocating from unbounded sizes. */
export async function readRuntimeModuleFile(path: string, maximum: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > runtimeModuleMaximumBytes)
    throw new Error("runtime_module_size_limit");
  const beforePath = await lstat(path, { bigint: true });
  if (!beforePath.isFile() || beforePath.isSymbolicLink())
    throw new Error("runtime_module_file_invalid");
  const file = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const before = await file.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.size < 1n ||
      before.size > BigInt(maximum) ||
      !sameFileIdentityAcrossStatSurfaces(beforePath, before)
    )
      throw new Error("runtime_module_file_invalid");
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await file.read(bytes, length, bytes.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await file.stat({ bigint: true });
    const afterPath = await lstat(path, { bigint: true });
    if (
      BigInt(length) !== before.size ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      !sameFileIdentityAcrossStatSurfaces(afterPath, before)
    )
      throw new Error("runtime_module_file_changed");
    return bytes.subarray(0, length);
  } finally {
    await file.close();
  }
}

export function validateRuntimeModuleArtifact(artifact: RuntimeModuleArtifact): void {
  const manifestBytes = artifact.files.get(runtimeModuleManifest);
  if (!manifestBytes || manifestBytes.length > runtimeModuleManifestMaximumBytes)
    throw new Error("runtime_module_manifest_invalid");
  const manifest = validateRuntimeModuleManifest(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)),
  );
  if (artifact.files.size !== manifest.files.length + 1)
    throw new Error("runtime_module_inventory_invalid");
  let total = manifestBytes.length;
  for (const file of manifest.files) {
    const bytes = artifact.files.get(file.name);
    if (!bytes || bytes.length !== file.size || runtimeModuleHash(bytes) !== file.sha256)
      throw new Error("runtime_module_content_mismatch");
    total += bytes.length;
  }
  if (total > runtimeModuleMaximumBytes) throw new Error("runtime_module_size_limit");
  if (runtimeModuleHash(manifestBytes) !== artifact.hash)
    throw new Error("runtime_module_digest_mismatch");
}

/** The manifest hash binds every member hash; returned bytes are the admitted snapshot. */
export async function readRuntimeModuleArtifact(directory: string): Promise<RuntimeModuleArtifact> {
  const before = await lstat(directory, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink())
    throw new Error("runtime_module_directory_invalid");
  const manifestBytes = await readRuntimeModuleFile(
    resolve(directory, runtimeModuleManifest),
    runtimeModuleManifestMaximumBytes,
  );
  const manifest = validateRuntimeModuleManifest(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)),
  );
  const expected = [runtimeModuleManifest, ...manifest.files.map((file) => file.name)].sort();
  async function inventory() {
    const names = (await readdir(directory))
      .filter(
        (name) =>
          name === runtimeModuleManifest ||
          name === "repository-runtime.js" ||
          name.startsWith("repository-runtime-"),
      )
      .sort();
    if (
      JSON.stringify(names) !== JSON.stringify(expected) ||
      names.some((name) => name !== runtimeModuleManifest && !isRuntimeModuleName(name))
    )
      throw new Error("runtime_module_inventory_invalid");
  }
  await inventory();
  const files = new Map<string, Buffer>([[runtimeModuleManifest, manifestBytes]]);
  let remaining = runtimeModuleMaximumBytes - manifestBytes.length;
  for (const file of manifest.files) {
    if (file.size > remaining) throw new Error("runtime_module_size_limit");
    files.set(file.name, await readRuntimeModuleFile(resolve(directory, file.name), file.size));
    remaining -= file.size;
  }
  const artifact = { files, hash: runtimeModuleHash(manifestBytes) };
  validateRuntimeModuleArtifact(artifact);
  await inventory();
  const after = await lstat(directory, { bigint: true });
  if (
    !after.isDirectory() ||
    after.isSymbolicLink() ||
    after.dev !== before.dev ||
    after.ino !== before.ino ||
    !(
      await readRuntimeModuleFile(
        resolve(directory, runtimeModuleManifest),
        runtimeModuleManifestMaximumBytes,
      )
    ).equals(manifestBytes)
  )
    throw new Error("runtime_module_directory_changed");
  return artifact;
}
