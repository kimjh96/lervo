import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type NativeCasOperation = readonly [string] | readonly [string, string, string];
export type NativeCasFailure = {
  status: "failed";
  created: boolean;
  code: "unsafe_path" | "system_error";
  errno: number;
  syscall: "mkdir" | "lstat" | "link" | "open" | "fstat" | "read" | "close";
  pathIndex: number;
};
export type NativeCasResult =
  | { status: "complete"; created: boolean; bytes: Buffer }
  | { status: "large"; created: boolean }
  | NativeCasFailure;
export interface NativeCas {
  batch(operations: readonly NativeCasOperation[]): Promise<NativeCasResult[]>;
}

function readAsset(path: URL, limit: number): Buffer {
  const observed = lstatSync(path);
  if (!observed.isFile() || observed.isSymbolicLink() || observed.size > limit)
    throw new Error("Invalid native CAS asset.");
  const descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== observed.dev ||
      opened.ino !== observed.ino ||
      opened.size > limit
    )
      throw new Error("Native CAS asset changed.");
    const buffer = Buffer.alloc(opened.size + 1);
    let length = 0;
    while (length < buffer.byteLength) {
      const count = readSync(descriptor, buffer, length, buffer.byteLength - length, null);
      if (!count) break;
      length += count;
    }
    if (length !== opened.size) throw new Error("Native CAS asset changed.");
    return buffer.subarray(0, length);
  } finally {
    closeSync(descriptor);
  }
}

/** Optional build-owned assets. Execution never compiles or downloads an addon. */
export function loadNativeCas(
  platform: NodeJS.Platform = process.platform,
  base: URL = new URL("./native/", import.meta.url),
  load: (path: URL) => unknown = (path) => createRequire(import.meta.url)(fileURLToPath(path)),
  architecture: string = process.arch,
): NativeCas | undefined {
  if (platform !== "darwin" || !["arm64", "x64"].includes(architecture)) return undefined;
  const binary = new URL("cas-io-darwin.node", base);
  try {
    const directory = lstatSync(dirname(fileURLToPath(binary)));
    if (!directory.isDirectory() || directory.isSymbolicLink())
      throw new Error("Invalid native CAS asset directory.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let bytes: Buffer;
  try {
    bytes = readAsset(new URL("cas-io.json", base), 4096);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try {
      lstatSync(binary);
    } catch (binaryError) {
      if ((binaryError as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw binaryError;
    }
    throw new Error("Native CAS manifest is missing.", { cause: error });
  }
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (
    !manifest ||
    manifest.schemaVersion !== 1 ||
    manifest.apiVersion !== 1 ||
    manifest.napiVersion !== 8 ||
    manifest.platform !== "darwin" ||
    JSON.stringify(manifest.architectures) !== '["arm64","x64"]' ||
    !/^sha256:[a-f0-9]{64}$/u.test(manifest.contentHash) ||
    !/^sha256:[a-f0-9]{64}$/u.test(manifest.sourceHash)
  )
    throw new Error("Invalid native CAS manifest.");
  const contentHash = `sha256:${createHash("sha256").update(readAsset(binary, 1048576)).digest("hex")}`;
  if (contentHash !== manifest.contentHash) throw new Error("Native CAS artifact changed.");
  let native: Partial<NativeCas> | null;
  try {
    native = load(binary) as Partial<NativeCas> | null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "ERR_DLOPEN_FAILED") return undefined;
    throw error;
  }
  if (!native || typeof native.batch !== "function")
    throw new Error("Invalid native CAS contract.");
  return { batch: (operations) => native.batch!(operations) };
}
