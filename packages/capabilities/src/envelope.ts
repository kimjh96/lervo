import { validateSchema, type CapabilityPackageManifest } from "@lervo/schemas";

import {
  CAPABILITY_MANIFEST,
  hashCapabilityFiles,
  isSafeCapabilityContentPath,
} from "./package-reader.js";
import {
  CapabilityPackageError,
  type CapabilityPackageFile,
  type VerifiedCapabilityPackage,
} from "./types.js";

export interface CapabilityPackageEnvelope {
  schemaVersion: 1;
  manifest: CapabilityPackageManifest;
  files: Array<{ path: string; contentBase64: string }>;
}

export function encodeCapabilityPackage(
  value: VerifiedCapabilityPackage,
): CapabilityPackageEnvelope {
  return {
    schemaVersion: 1,
    manifest: structuredClone(value.manifest),
    files: value.files
      .filter((file) => file.path !== CAPABILITY_MANIFEST)
      .map((file) => ({
        path: file.path,
        contentBase64: Buffer.from(file.bytes).toString("base64"),
      })),
  };
}

export function decodeCapabilityPackage(value: unknown): VerifiedCapabilityPackage {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new CapabilityPackageError("capability_invalid", "The capability envelope is invalid.");
  const input = value as { schemaVersion?: unknown; manifest?: unknown; files?: unknown };
  if (
    input.schemaVersion !== 1 ||
    !validateSchema("capabilityPackageManifest", input.manifest).valid ||
    !Array.isArray(input.files) ||
    input.files.length > 256
  )
    throw new CapabilityPackageError(
      "capability_invalid",
      "The capability envelope does not satisfy the v1 contract.",
    );
  const paths = new Set<string>();
  const files: CapabilityPackageFile[] = [];
  for (const raw of input.files) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw))
      throw new CapabilityPackageError(
        "capability_invalid",
        "A capability envelope file is invalid.",
      );
    const file = raw as { path?: unknown; contentBase64?: unknown };
    if (
      typeof file.path !== "string" ||
      !isSafeCapabilityContentPath(file.path) ||
      file.path === CAPABILITY_MANIFEST ||
      paths.has(file.path) ||
      typeof file.contentBase64 !== "string" ||
      file.contentBase64.length > 24 * 1024 * 1024 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(file.contentBase64)
    )
      throw new CapabilityPackageError(
        "capability_invalid",
        "A capability envelope file path or payload is invalid.",
      );
    paths.add(file.path);
    files.push({
      path: file.path,
      bytes: new Uint8Array(Buffer.from(file.contentBase64, "base64")),
    });
  }
  const manifest = structuredClone(input.manifest) as CapabilityPackageManifest;
  const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  const all = [{ path: CAPABILITY_MANIFEST, bytes: manifestBytes }, ...files];
  if (hashCapabilityFiles(all) !== manifest.contentHash)
    throw new CapabilityPackageError(
      "capability_content_hash_mismatch",
      "The capability envelope content hash is invalid.",
    );
  return { manifest, directoryPath: "envelope:", files: all };
}
