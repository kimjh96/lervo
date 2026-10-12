import { createHash } from "node:crypto";

export const runtimeModuleEntry = "repository-runtime.js";
export const runtimeModuleManifest = "repository-runtime.json";
export const runtimeModuleMaximumBytes = 64 * 1024 * 1024;
export const runtimeModuleManifestMaximumBytes = 64 * 1024;
export const runtimeModuleMaximumFiles = 128;

export interface RuntimeModuleFile {
  name: string;
  size: number;
  sha256: string;
}
export interface RuntimeModuleManifest {
  schemaVersion: 1;
  entry: typeof runtimeModuleEntry;
  files: RuntimeModuleFile[];
}

export const runtimeModuleHash = (bytes: Uint8Array | string): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export function isRuntimeModuleName(name: string): boolean {
  return (
    name === runtimeModuleEntry ||
    /^repository-runtime-[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\.(?:js|cjs)$/u.test(name)
  );
}

function exactKeys(value: object, keys: string[]): boolean {
  return Object.keys(value).sort().join("\n") === keys.sort().join("\n");
}

/** Names describe a flat, bounded artifact namespace, never caller-selected paths. */
export function validateRuntimeModuleManifest(value: unknown): RuntimeModuleManifest {
  const fail = (): never => {
    throw new Error("runtime_module_manifest_invalid");
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const manifest = value as RuntimeModuleManifest;
  if (
    !exactKeys(manifest, ["schemaVersion", "entry", "files"]) ||
    manifest.schemaVersion !== 1 ||
    manifest.entry !== runtimeModuleEntry ||
    !Array.isArray(manifest.files) ||
    manifest.files.length < 1 ||
    manifest.files.length > runtimeModuleMaximumFiles
  )
    return fail();
  const portableNames = new Set<string>();
  let total = 0;
  let previous = "";
  let entry = false;
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file !== "object" ||
      Array.isArray(file) ||
      !exactKeys(file, ["name", "size", "sha256"]) ||
      typeof file.name !== "string" ||
      !isRuntimeModuleName(file.name) ||
      file.name <= previous ||
      !Number.isSafeInteger(file.size) ||
      file.size < 1 ||
      typeof file.sha256 !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(file.sha256)
    )
      return fail();
    if (portableNames.has(file.name.toLowerCase())) return fail();
    portableNames.add(file.name.toLowerCase());
    total += file.size;
    if (total > runtimeModuleMaximumBytes) return fail();
    previous = file.name;
    entry ||= file.name === runtimeModuleEntry;
  }
  if (!entry) return fail();
  return manifest;
}
