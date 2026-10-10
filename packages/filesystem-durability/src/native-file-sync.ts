import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export interface NativeFileSync {
  /** False means eligibility was rejected before any synchronization call. */
  synchronize(descriptors: number[]): Promise<boolean>;
}

/** Optional packaged acceleration; missing support retains ordinary FileHandle.sync. */
export function loadNativeFileSync(
  platform: NodeJS.Platform = process.platform,
  base: URL = new URL("./native/", import.meta.url),
  load: (path: URL) => unknown = (path) => createRequire(import.meta.url)(fileURLToPath(path)),
  architecture: string = process.arch,
): NativeFileSync | undefined {
  if (platform !== "darwin" || !["arm64", "x64"].includes(architecture)) return undefined;
  let bytes: Buffer;
  try {
    const path = new URL("file-sync.json", base);
    const entry = lstatSync(path);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 4096)
      throw new Error("Invalid native synchronization manifest.");
    bytes = readFileSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (bytes.byteLength > 4096) throw new Error("Invalid native synchronization manifest.");
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (
    manifest.schemaVersion !== 1 ||
    manifest.apiVersion !== 1 ||
    manifest.napiVersion !== 8 ||
    manifest.platform !== "darwin" ||
    JSON.stringify(manifest.architectures) !== '["arm64","x64"]' ||
    !/^sha256:[a-f0-9]{64}$/u.test(manifest.contentHash) ||
    !/^sha256:[a-f0-9]{64}$/u.test(manifest.sourceHash)
  )
    throw new Error("Invalid native synchronization manifest.");
  const path = new URL("file-sync-darwin.node", base);
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 1048576)
    throw new Error("Invalid native synchronization artifact.");
  const hash = `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
  if (hash !== manifest.contentHash) throw new Error("Native synchronization artifact changed.");
  let native: Partial<NativeFileSync> | null;
  try {
    native = load(path) as Partial<NativeFileSync> | null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_DLOPEN_FAILED") return undefined;
    throw error;
  }
  if (!native || typeof native.synchronize !== "function")
    throw new Error("Invalid native synchronization contract.");
  return { synchronize: (descriptors) => native.synchronize!(descriptors) };
}
